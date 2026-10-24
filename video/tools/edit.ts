// Builds one episode's edit in Neon Video Studio from its recorded takes and narration.
//
//   node video/tools/neon.ts serve           # a private Neon instance for this series
//   node video/tools/edit.ts <episode>          # builds ~/Videos/git-gud-series/<episode>.neon
//   node video/tools/edit.ts <episode> --render # and renders video/build/renders/<episode>.mp4
//
// The script goes into Neon's Script view with every line placed, and each voice-over clip is
// linked to its line, so a line can be re-recorded with Neon's prompter later.
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LINE_GAP, type TakeResult, type VoLine } from "./director.ts";
import { episodes } from "./episodes.mjs";
import { neon } from "./neon.ts";

const VIDEO = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(VIDEO, "build");
const FPS = 30;
const ACCENT = "#ff4fc3";
const FFMPEG = join(homedir(), ".neon-video", "tools", "ffmpeg");
/** Silent title card that opens an episode whose first line is not already a title. */
const STING = 3.2;

type Fx = { name: string; props: Record<string, unknown> };
type Line = { say: string; show?: string; take?: string; fx?: Fx };
type Episode = { id: string; title: string; subtitle: string; sections: { title: string; intent?: string; take?: string; lines: Line[] }[] };

const id = process.argv[2];
const all: Episode[] = await episodes();
const index = all.findIndex((e) => e.id === id);
if (index === -1) throw new Error(`No episode ${id}. Episodes: ${all.map((e) => e.id).join(", ")}`);
const episode = all[index]!;
const number = index + 1;
const project = join(homedir(), "Videos", "git-gud-series", `${episode.id}.neon`);

const voDir = join(BUILD, "vo", episode.id);
const vo: Map<string, VoLine> = new Map(JSON.parse(await readFile(join(voDir, "manifest.json"), "utf8")).lines.map((l: VoLine) => [l.id, l]));
const takesDir = join(BUILD, "takes", episode.id);

/** What is on screen for each line: a recorded take, or a Git Gud FX component. */
type Visual = { kind: "take"; take: string } | { kind: "fx"; fx: Fx };
const lines = episode.sections.flatMap((section, s) => section.lines.map((line, l) => ({ id: `${s + 1}.${l + 1}`, section: s + 1, line, sectionTake: section.take })));
const visualFor = (entry: (typeof lines)[number]): Visual => {
  if (entry.line.fx) return { kind: "fx", fx: entry.line.fx };
  const take = entry.line.take ?? entry.sectionTake;
  if (!take) throw new Error(`Line ${episode.id} ${entry.id} has neither fx nor take`);
  return { kind: "take", take };
};
const sameVisual = (a: Visual, b: Visual) => JSON.stringify(a) === JSON.stringify(b);

const takes = new Map<string, TakeResult>();
for (const entry of lines) {
  const visual = visualFor(entry);
  if (visual.kind === "take" && !takes.has(visual.take)) takes.set(visual.take, JSON.parse(await readFile(join(takesDir, `${visual.take}.json`), "utf8")));
}

// Lay the lines out end to end. A run of lines from one take keeps the take's own timing.
type Placed = { id: string; at: number; duration: number; section: number };
type Segment = { visual: Visual; at: number; length: number; trim: number; lines: Placed[] };
const segments: Segment[] = [];
const opensWithTitle = lines[0]!.line.fx?.name === "GitGudTitle";
let cursor = opensWithTitle ? 0 : STING;
for (let i = 0; i < lines.length; ) {
  const visual = visualFor(lines[i]!);
  let j = i;
  while (j + 1 < lines.length && sameVisual(visualFor(lines[j + 1]!), visual)) j++;
  const run = lines.slice(i, j + 1);
  if (visual.kind === "take") {
    const take = takes.get(visual.take)!;
    const startOf = (lineId: string) => {
      const found = take.lines.find((l) => l.id === lineId);
      if (!found) throw new Error(`Take ${visual.take} has no line ${lineId}`);
      return found.start;
    };
    // A line ends where the take's next line starts, so the action after the words stays in.
    const endOf = (lineId: string) => {
      const after = take.lines.filter((l) => l.start > startOf(lineId)).sort((a, b) => a.start - b.start)[0];
      const next = after?.start ?? take.duration;
      // With two windows recording at once, the gap before this take's next line is the other window's turn.
      const own = take.lines.find((l) => l.id === lineId)?.end;
      return own !== undefined && next - own > 2 ? own + 0.3 : next;
    };
    const trim = startOf(run[0]!.id);
    const length = endOf(run.at(-1)!.id) - trim;
    segments.push({ visual, at: cursor, length, trim, lines: run.map((r) => ({ id: r.id, section: r.section, at: cursor + startOf(r.id) - trim, duration: vo.get(r.id)!.duration })) });
    cursor += length;
  } else {
    const placed: Placed[] = [];
    let t = cursor + 0.4;
    for (const r of run) {
      placed.push({ id: r.id, section: r.section, at: t, duration: vo.get(r.id)!.duration });
      t += vo.get(r.id)!.duration + LINE_GAP;
    }
    segments.push({ visual, at: cursor, length: t - cursor + 0.3, trim: 0, lines: placed });
    cursor = t + 0.3;
  }
  i = j + 1;
}
const total = cursor;
process.stdout.write(`${episode.id}: ${segments.length} segments, ${(total / 60).toFixed(2)} minutes\n`);
const frames = (seconds: number) => Math.round(seconds * FPS);

// Narration at broadcast loudness.
const normDir = join(BUILD, "vo-norm", episode.id);
await mkdir(normDir, { recursive: true });
for (const lineId of vo.keys()) {
  const out = join(normDir, `${lineId}.m4a`);
  const source = join(voDir, `${lineId}.mp3`);
  // Line numbers shift when the script changes, so a cached file is reused only if it is newer than its source.
  if (!existsSync(out) || statSync(out).mtimeMs < statSync(source).mtimeMs) {
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", source, "-af", "loudnorm=I=-16:TP=-1.5:LRA=7", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", out]);
  }
}

// A fresh project each run.
await mkdir(dirname(project), { recursive: true });
neon("project", "new", "--name", `Git Gud ${number}: ${episode.title}`, "--fps", String(FPS), "--width", "1920", "--height", "1080");
if (existsSync(project)) await rm(project, { recursive: true, force: true });
neon("project", "save", project);
neon("packs", "install", join(VIDEO, "fx", "gitgud-fx"));
type Track = { id: string; name: string; kind: string };
const listTracks = () => neon<{ tracks: Track[] }>("timeline", "show").tracks;
neon("tracks", "add", "--kind", "overlay", "--name", "FX2");
const track = (name: string) => {
  const found = listTracks().find((t) => t.name === name);
  if (!found) throw new Error(`No track ${name}`);
  return found.id;
};
const V1 = track("V1");
const A1 = track("A1");
const FX1 = track("FX1");
const FX2 = track("FX2");

const importAsset = (path: string) => neon<{ asset: { id: string } }>("api", "POST", "assets/import", JSON.stringify({ path })).asset.id;
const takeAssets = new Map([...takes.keys()].map((name) => [name, importAsset(join(takesDir, `${name}.mp4`))]));
const voAssets = new Map([...vo.keys()].map((lineId) => [lineId, importAsset(join(normDir, `${lineId}.m4a`))]));

// The script, with every line placed where its narration plays.
const placed = new Map(segments.flatMap((s) => s.lines).map((l) => [l.id, l]));
const scriptBody = {
  sections: episode.sections.map((section, s) => ({
    title: section.title,
    intent: section.intent,
    status: "review",
    lines: section.lines.map((line, l) => {
      const p = placed.get(`${s + 1}.${l + 1}`)!;
      return { say: line.say, show: line.show, at: frames(p.at), duration: frames(p.duration) };
    }),
  })),
};
const scriptFile = join(BUILD, "neon", `${episode.id}-script.json`);
await mkdir(dirname(scriptFile), { recursive: true });
await writeFile(scriptFile, JSON.stringify(scriptBody, null, 2));
neon("script", "set", scriptFile);
type ScriptState = { sections: { lines: { id: string }[] }[] };
const scriptState = neon<ScriptState>("api", "GET", "script");
const lineIds = new Map(scriptState.sections.flatMap((section, s) => section.lines.map((line, l) => [`${s + 1}.${l + 1}`, line.id])));

type Op = { route: string; body: Record<string, unknown> };
const ops: Op[] = [];
const insert = (body: Record<string, unknown>) => {
  ops.push({ route: "/api/timeline/insert", body: { placement: "free", ...body } });
  return ops.length - 1;
};

if (!opensWithTitle) {
  insert({ kind: "component", componentName: "GitGudTitle", props: { title: episode.title, subtitle: episode.subtitle, footer: `Episode ${number}` }, at: 0, duration: frames(STING), trackId: FX1 });
}

for (const segment of segments) {
  const at = frames(segment.at);
  const duration = frames(segment.length);
  const { visual } = segment;
  if (visual.kind === "take") {
    const take = takes.get(visual.take)!;
    const op = insert({ kind: "video", assetId: takeAssets.get(visual.take), at, duration, trimBefore: frames(segment.trim), trackId: V1, name: visual.take });
    const inSegment = (t: number) => t >= segment.trim && t < segment.trim + segment.length;
    const global = (t: number) => frames(segment.at + t - segment.trim);
    for (const event of take.events) {
      if (event.kind === "zoom" && inSegment(event.from)) {
        ops.push({ route: "/api/timeline/zoom", body: { id: `$${op}.id`, from: global(event.from), to: Math.min(global(event.to), at + duration - 1), cx: event.center[0], cy: event.center[1], zoom: event.zoom, ramp: frames(0.45) } });
      } else if (event.kind === "keys" && inSegment(event.at)) {
        insert({ kind: "component", componentName: "KeyCombo", props: { combo: event.combo, platform: "mac", x: 0.5, y: 0.86, size: 34, color: ACCENT }, at: global(event.at), duration: frames(2), trackId: FX2 });
      } else if (event.kind === "callout" && inSegment(event.at)) {
        insert({ kind: "component", componentName: "Callout", props: { text: event.text, x: event.x, y: event.y, side: "auto", color: ACCENT, size: 30 }, at: global(event.at), duration: frames(event.duration), trackId: FX2 });
      }
    }
  } else {
    insert({ kind: "component", componentName: visual.fx.name, props: visual.fx.props, at, duration, trackId: FX1 });
  }
  for (const line of segment.lines) {
    insert({ kind: "audio", assetId: voAssets.get(line.id), at: frames(line.at), trackId: A1, scriptLineId: lineIds.get(line.id), name: `VO ${line.id}` });
  }
}

// Chapter labels where a section opens on footage.
for (const [s, section] of episode.sections.entries()) {
  const first = placed.get(`${s + 1}.1`)!;
  if (visualFor(lines.find((l) => l.id === `${s + 1}.1`)!).kind !== "take") continue;
  insert({ kind: "component", componentName: "GitGudChapter", props: { number: s + 1, title: section.title }, at: frames(first.at), duration: frames(3.5), trackId: FX2 });
}

const planFile = join(BUILD, "neon", `${episode.id}-plan.json`);
await writeFile(planFile, JSON.stringify({ ops }, null, 2));
neon("apply", planFile);
neon("project", "save");
process.stdout.write(`Applied ${ops.length} edits to ${project}\n`);

if (process.argv.includes("--render")) {
  const output = join(BUILD, "renders", `${episode.id}.mp4`);
  await mkdir(dirname(output), { recursive: true });
  neon("render", "--output", output, "--preset", "1080p30");
  process.stdout.write(`Rendered ${output}\n`);
}
