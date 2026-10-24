// Narrates every line of every episode with a local Kokoro TTS server and records how long each takes.
//
//   docker run -d --rm --name kokoro-gitgud -p 8881:8880 ghcr.io/remsky/kokoro-fastapi-cpu:v0.9.0
//   node video/tools/voice.mjs [episode...]
//
// Writes video/build/vo/<episode>/<section>.<line>.mp3 and a manifest.json per episode with each
// line's duration and word timings. Lines whose text and voice are unchanged are not regenerated.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { episodes } from "./episodes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KOKORO = process.env.KOKORO_URL ?? "http://127.0.0.1:8881";
// The voice of the htmlify tutorial, so the two series sound like one channel.
const VOICE = process.env.VOICE ?? "af_heart";
const FFPROBE = process.env.FFPROBE ?? join(homedir(), ".neon-video", "tools", "ffprobe");

/** Spoken forms for words the model reads wrong. Applied to the audio only, never to captions. */
const PRONOUNCE = [
  [/\bGit Gud\b/g, "Git Good"],
  [/\bgitgud-headless\b/g, "git good headless"],
  [/\bgitgud-relay\b/g, "git good relay"],
  [/\brerere\b/g, "ree-ree-ree"],
  [/\bGerrit\b/g, "[Gerrit](/ɡˈɛɹɪt/)"],
  [/\breflog\b/gi, "ref log"],
  [/\bSHAs\b/g, "shahs"],
  [/\bSHA\b/g, "shah"],
  [/\bSSE\b/g, "S S E"],
  [/\bHMAC\b/g, "H-mac"],
  [/\bSNI\b/g, "S N I"],
  [/\bAPK\b/g, "A P K"],
  [/\bUDP\b/g, "U D P"],
  [/\bTLS\b/g, "T L S"],
  [/\bLAN\b/g, "lan"],
  [/\bQR\b/g, "Q R"],
  [/\bsystemd\b/g, "system D"],
  [/\bGitLab\b/g, "Git Lab"],
  [/\bGitHub\b/g, "Git Hub"],
  [/\bJSON\b/g, "jason"],
  [/\bRPC\b/g, "R P C"],
  [/\bCLI\b/g, "C L I"],
  [/\btidepool\b/g, "tide pool"],
  [/\b47831\b/g, "four seven eight three one"],
  [/\b47832\b/g, "four seven eight three two"],
  [/\b47833\b/g, "four seven eight three three"],
  [/\bv1\.2\.0\b/g, "version one point two"],
  [/\bWIP\b/g, "whip"],
];

const spoken = (text) => PRONOUNCE.reduce((t, [pattern, replacement]) => t.replace(pattern, replacement), text);

const only = new Set(process.argv.slice(2));
let grand = 0;
for (const episode of await episodes()) {
  if (only.size && !only.has(episode.id)) continue;
  const out = join(ROOT, "build", "vo", episode.id);
  await mkdir(out, { recursive: true });
  const manifestPath = join(out, "manifest.json");
  const previous = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, "utf8")) : { lines: [] };
  const lines = [];
  for (const [s, section] of episode.sections.entries()) {
    for (const [l, line] of section.lines.entries()) {
      const id = `${s + 1}.${l + 1}`;
      const file = join(out, `${id}.mp3`);
      // Each finished line also keeps a sidecar, so an interrupted run picks up where it stopped.
      const sidecar = join(out, `${id}.json`);
      const saved = existsSync(sidecar) ? JSON.parse(await readFile(sidecar, "utf8")) : undefined;
      const cached = [saved, ...previous.lines].find((p) => p && p.say === line.say && p.voice === VOICE && existsSync(join(out, p.file)));
      if (cached) {
        // Lines move when the script changes; reuse the audio under the new id.
        if (cached.id !== id) await writeFile(file, await readFile(join(out, cached.file)));
        lines.push({ ...cached, id, file: `${id}.mp3` });
        continue;
      }
      const response = await fetch(`${KOKORO}/dev/captioned_speech`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "kokoro", voice: VOICE, input: spoken(line.say), response_format: "mp3", stream: false }),
      });
      if (!response.ok) throw new Error(`Kokoro failed on ${episode.id} ${id}: HTTP ${response.status} ${await response.text()}`);
      const body = await response.json();
      await writeFile(file, Buffer.from(body.audio, "base64"));
      const duration = Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
      const words = (body.timestamps ?? []).map((w) => ({ word: w.word, start: w.start_time, end: w.end_time }));
      const entry = { id, say: line.say, voice: VOICE, file: `${id}.mp3`, duration, words };
      await writeFile(sidecar, JSON.stringify(entry));
      lines.push(entry);
      process.stdout.write(`${episode.id} ${id}  ${duration.toFixed(2)}s  ${line.say.slice(0, 60)}\n`);
    }
  }
  const total = lines.reduce((sum, l) => sum + l.duration, 0);
  grand += total;
  await writeFile(manifestPath, `${JSON.stringify({ voice: VOICE, total, lines }, null, 2)}\n`);
  process.stdout.write(`${episode.id}: ${lines.length} lines, ${(total / 60).toFixed(1)} minutes of narration\n`);
}
process.stdout.write(`all: ${(grand / 60).toFixed(1)} minutes of narration\n`);
