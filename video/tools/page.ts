// Builds the series watch page: every episode with chapters and captions, plus a gallery of the
// diagrams and cards that appear in them.
//
//   node video/tools/page.ts      # after render-all.sh
//
// Writes video/build/publish/git-gud-series-<date>.html and its -assets folder. Line times come
// from the script each edit placed (build/neon/<episode>-script.json).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { VoLine } from "./director.ts";
import { episodes } from "./episodes.mjs";

const VIDEO = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(VIDEO, "build");
const SLUG = `git-gud-series-${new Date().toISOString().slice(0, 10)}`;
const OUT = join(BUILD, "publish");
const ASSETS = join(OUT, `${SLUG}-assets`);
const FPS = 30;
const FFMPEG = join(homedir(), ".neon-video", "tools", "ffmpeg");
const FFPROBE = join(homedir(), ".neon-video", "tools", "ffprobe");

const stamp = (seconds: number, vtt = true) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  return vtt ? `${String(h).padStart(2, "0")}:${mm}:${s.toFixed(3).padStart(6, "0")}` : `${m}:${String(Math.floor(s)).padStart(2, "0")}`;
};
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

type Placed = { sections: { title: string; lines: { say: string; at: number; duration: number }[] }[] };
type Op = { route: string; body: { componentName?: string; props?: Record<string, unknown>; at?: number; duration?: number } };

await rm(OUT, { recursive: true, force: true });
await mkdir(ASSETS, { recursive: true });

const series: { id: string; number: number; title: string; subtitle: string; length: number; chapters: { title: string; at: number }[] }[] = [];
const gallery: { episode: number; file: string; caption: string; at: number }[] = [];
let total = 0;

for (const [index, episode] of (await episodes()).entries()) {
  const render = join(BUILD, "renders", `${episode.id}.mp4`);
  if (!existsSync(render)) throw new Error(`No render for ${episode.id}; run tools/render-all.sh`);
  const placed: Placed = JSON.parse(await readFile(join(BUILD, "neon", `${episode.id}-script.json`), "utf8"));
  const vo = new Map<string, VoLine>(JSON.parse(await readFile(join(BUILD, "vo", episode.id, "manifest.json"), "utf8")).lines.map((l: VoLine) => [l.id, l]));
  const length = Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", render]).toString());
  total += length;

  // Captions: each line split at sentence ends or every eight words, timed from the voice's word timings.
  const cues: string[] = ["WEBVTT", ""];
  const chapters: { title: string; at: number }[] = [];
  for (const [s, section] of placed.sections.entries()) {
    for (const [l, line] of section.lines.entries()) {
      const start = line.at / FPS;
      if (l === 0) chapters.push({ title: section.title, at: Math.max(0, start - 0.4) });
      const words = vo.get(`${s + 1}.${l + 1}`)?.words.filter((w) => /\w/.test(w.word)) ?? [];
      if (words.length === 0) continue;
      // The script's own spelling, so "Git Gud" and "SHA" read as written.
      const written = line.say.split(/\s+/);
      const perWord = words.length / written.length;
      let chunk: { text: string[]; from: number; to: number } | undefined;
      const flush = () => {
        if (chunk) cues.push(`${stamp(start + chunk.from)} --> ${stamp(start + chunk.to)}`, chunk.text.join(" "), "");
        chunk = undefined;
      };
      written.forEach((text, i) => {
        const w = words[Math.min(words.length - 1, Math.floor(i * perWord))]!;
        chunk ??= { text: [], from: w.start, to: w.end };
        chunk.text.push(text);
        chunk.to = w.end;
        if (/[.?!:]$/.test(text) || chunk.text.length >= 8) flush();
      });
      flush();
    }
  }
  await copyFile(render, join(ASSETS, `${episode.id}.mp4`));
  await writeFile(join(ASSETS, `${episode.id}.vtt`), cues.join("\n"));
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-ss", "1.6", "-i", render, "-frames:v", "1", "-vf", "scale=960:-1", "-q:v", "3", join(ASSETS, `${episode.id}.jpg`)]);

  // The infographics: each diagram or card, caught once it has fully built.
  const ops: Op[] = JSON.parse(await readFile(join(BUILD, "neon", `${episode.id}-plan.json`), "utf8")).ops;
  const seen = new Set<string>();
  for (const op of ops) {
    const name = op.body.componentName;
    if (name !== "GitGudDiagram" && name !== "GitGudCard") continue;
    const key = JSON.stringify(op.body.props);
    if (seen.has(key)) continue;
    seen.add(key);
    const at = (op.body.at! + op.body.duration! * 0.85) / FPS;
    const file = `${episode.id}-fx-${gallery.length}.jpg`;
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-ss", at.toFixed(2), "-i", render, "-frames:v", "1", "-vf", "scale=1280:-1", "-q:v", "3", join(ASSETS, file)]);
    const props = op.body.props ?? {};
    gallery.push({ episode: index + 1, file, at, caption: String(props.title ?? props.caption ?? "") });
  }
  series.push({ id: episode.id, number: index + 1, title: episode.title, subtitle: episode.subtitle, length, chapters });
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Git Gud: the complete tour</title>
<style>
  :root { color-scheme: dark; --bg: #0d1117; --panel: #1a2030; --hover: #2a3347; --line: rgba(255,255,255,.11); --text: #f0f4f8; --muted: #aab4bf; --accent: #ff4fc3; }
  body { margin: 0; background: radial-gradient(1200px 600px at 70% -10%, rgba(255,79,195,.10), transparent 70%), var(--bg); color: var(--text); font: 16px/1.6 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 1280px; margin: 0 auto; padding: 40px 24px 80px; }
  .kicker { color: var(--accent); font-weight: 600; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; }
  h1 { font-size: 38px; line-height: 1.12; margin: 8px 0 6px; letter-spacing: -0.01em; }
  h2 { font-size: 18px; margin: 0 0 10px; }
  .lede { color: var(--muted); margin: 0 0 26px; max-width: 760px; }
  .player { display: grid; grid-template-columns: 1fr 340px; gap: 24px; align-items: start; }
  video { width: 100%; border-radius: 12px; background: #000; box-shadow: 0 20px 60px rgba(0,0,0,.5), 0 0 0 1px var(--line); }
  .now { margin: 14px 0 0; } .now b { color: var(--accent); }
  aside { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px; max-height: 760px; overflow: auto; }
  ol { list-style: none; margin: 0; padding: 0; }
  button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; text-align: left; }
  .ep { display: grid; grid-template-columns: 28px 1fr auto; gap: 10px; width: 100%; padding: 8px 10px; border-radius: 8px; align-items: baseline; }
  .ep:hover { background: var(--hover); } .ep.active { background: rgba(255,79,195,.14); box-shadow: inset 3px 0 0 var(--accent); }
  .ep .n { color: var(--accent); font-weight: 700; font-variant-numeric: tabular-nums; }
  .ep small { color: var(--muted); font-variant-numeric: tabular-nums; }
  .chapters { margin: 2px 0 10px 38px; } .chapters button { display: flex; gap: 10px; padding: 3px 8px; border-radius: 6px; width: 100%; font-size: 14px; color: var(--muted); }
  .chapters button:hover { background: var(--hover); color: var(--text); } .chapters time { color: var(--accent); min-width: 36px; font-variant-numeric: tabular-nums; }
  section { margin-top: 48px; }
  .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
  .gallery figure { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; cursor: pointer; }
  .gallery img { width: 100%; display: block; } .gallery figcaption { padding: 8px 12px; font-size: 14px; color: var(--muted); } .gallery figcaption b { color: var(--accent); margin-right: 6px; }
  .notes ul { padding-left: 20px; color: var(--muted); } .notes li { margin: 6px 0; } a { color: var(--accent); } code { font-size: 14px; }
  @media (max-width: 960px) { .player { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
  <div class="kicker">Git Gud · video series</div>
  <h1>Git Gud: the complete tour</h1>
  <p class="lede">${series.length} episodes, ${Math.round(total / 60)} minutes: the desktop app, the headless daemon, the relay and the phone app. Every scene is the real app, driven by a script against a demo repository.</p>
  <div class="player">
    <div>
      <video id="v" controls preload="metadata"></video>
      <p class="now" id="now"></p>
    </div>
    <aside>
      <ol>
        ${series.map((e) => `<li><button class="ep" data-ep="${e.id}"><span class="n">${String(e.number).padStart(2, "0")}</span><span>${escape(e.title)}</span><small>${stamp(e.length, false)}</small></button>
          <div class="chapters" data-for="${e.id}" hidden>${e.chapters.map((c) => `<button data-t="${c.at.toFixed(2)}"><time>${stamp(c.at, false)}</time><span>${escape(c.title)}</span></button>`).join("")}</div></li>`).join("\n        ")}
      </ol>
    </aside>
  </div>
  <section>
    <h2>Infographics</h2>
    <p class="lede">The diagrams and cards from the series. Click one to jump to it.</p>
    <div class="gallery">
      ${gallery.map((g) => `<figure data-jump="${series[g.episode - 1]!.id}" data-t="${(g.at - 2).toFixed(2)}"><img loading="lazy" src="${SLUG}-assets/${g.file}" alt="${escape(g.caption)}"><figcaption><b>${String(g.episode).padStart(2, "0")}</b>${escape(g.caption)}</figcaption></figure>`).join("\n      ")}
    </div>
  </section>
  <section class="notes">
    <h2>How these videos were made</h2>
    <ul>
      <li>The narration is a local neural voice (Kokoro, voice <code>af_heart</code>), the same voice as the htmlify tutorial.</li>
      <li>The footage is Git Gud ${escape(JSON.parse(await readFile(join(VIDEO, "..", "package.json"), "utf8")).version)} built from source, driven by Playwright against a demo repository, with a drawn cursor and actions timed to the spoken words.</li>
      <li>Peer scenes use two real Git Gud instances on one machine. The daemon scenes replay gitgud-headless's real output. The Gerrit scenes use a small local stand-in for Gerrit's REST API. GitHub sign-in is answered locally, so no account appears.</li>
      <li>The phone scenes show the companion app's web build in a phone frame, connected to a real host. Android and iOS run the same screens.</li>
      <li>Each episode was assembled and rendered in Neon Video Studio with its own FX pack in Git Gud's colors. The production kit is in the Git Gud repository under <code>video/</code>.</li>
    </ul>
  </section>
</main>
<script>
  const video = document.getElementById("v");
  const now = document.getElementById("now");
  const titles = ${JSON.stringify(Object.fromEntries(series.map((e) => [e.id, `${String(e.number).padStart(2, "0")} · ${e.title}: ${e.subtitle}`])))};
  function load(id, t = 0, play = false) {
    if (video.dataset.ep !== id) {
      video.dataset.ep = id;
      video.innerHTML = '<source src="${SLUG}-assets/' + id + '.mp4" type="video/mp4"><track kind="captions" src="${SLUG}-assets/' + id + '.vtt" srclang="en" label="English" default>';
      video.poster = "${SLUG}-assets/" + id + ".jpg";
      video.load();
      now.innerHTML = "<b>Now playing</b> " + titles[id];
      for (const b of document.querySelectorAll(".ep")) b.classList.toggle("active", b.dataset.ep === id);
      for (const c of document.querySelectorAll(".chapters")) c.hidden = c.dataset.for !== id;
      history.replaceState(null, "", "#" + id);
    }
    const seek = () => { video.currentTime = t; if (play) video.play(); };
    video.readyState >= 1 ? seek() : video.addEventListener("loadedmetadata", seek, { once: true });
  }
  for (const b of document.querySelectorAll(".ep")) b.addEventListener("click", () => load(b.dataset.ep, 0, true));
  for (const c of document.querySelectorAll(".chapters")) for (const b of c.querySelectorAll("[data-t]")) b.addEventListener("click", () => load(c.dataset.for, Number(b.dataset.t), true));
  for (const f of document.querySelectorAll("[data-jump]")) f.addEventListener("click", () => { load(f.dataset.jump, Math.max(0, Number(f.dataset.t)), true); window.scrollTo({ top: 0, behavior: "smooth" }); });
  // Play the next episode when one ends.
  const order = ${JSON.stringify(series.map((e) => e.id))};
  video.addEventListener("ended", () => { const i = order.indexOf(video.dataset.ep); if (i + 1 < order.length) load(order[i + 1], 0, true); });
  load(order.includes(location.hash.slice(1)) ? location.hash.slice(1) : order[0]);
</script>
</body>
</html>
`;
await writeFile(join(OUT, `${SLUG}.html`), html);
process.stdout.write(`${join(OUT, `${SLUG}.html`)}\n${series.length} episodes, ${(total / 60).toFixed(1)} minutes, ${gallery.length} infographics\n`);
