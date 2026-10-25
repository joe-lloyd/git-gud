// Thumbnails and YouTube uploads for the series, through Neon's thumbnail editor and upload pipeline.
//
//   node video/tools/youtube.ts thumbs [episode...]     # build/thumbs/<episode>.png
//   node video/tools/youtube.ts upload [episode...]     # uploads; ids land in video/youtube.json
//   node video/tools/youtube.ts describe <episode>      # print the description it would use
//
// Each episode's thumbnail is its own Neon project's thumbnail: a frame of the episode under the
// GitGudThumbnail template. Uploads already in youtube.json are skipped. Privacy comes from
// PRIVACY (default public).
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { episodes } from "./episodes.mjs";
import { neon } from "./neon.ts";

const VIDEO = join(import.meta.dirname, "..");
const BUILD = join(VIDEO, "build");
const FPS = 30;
const RECORD = join(VIDEO, "youtube.json");
const BLOG = "https://dev-blog.joe-lloyd.com";
const REPO = "https://github.com/joe-lloyd/git-gud";

type Episode = { id: string; title: string; subtitle: string; youtube: { thumbTitle: string; thumbKicker: string; thumbFrom: string }; sections: { title: string; lines: { say: string }[] }[] };
type Placed = { sections: { title: string; lines: { at: number; duration: number }[] }[] };
type Uploaded = Record<string, { videoId: string; url: string; title: string; privacy: string; uploadedAt: string }>;

const all: Episode[] = await episodes();
const [command, ...wanted] = process.argv.slice(2);
const chosen = all.filter((e) => wanted.length === 0 || wanted.includes(e.id));
const numberOf = (e: Episode) => all.indexOf(e) + 1;
const two = (n: number) => String(n).padStart(2, "0");
const project = (e: Episode) => join(homedir(), "Videos", "git-gud-series", `${e.id}.neon`);
const placed = async (e: Episode): Promise<Placed> => JSON.parse(await readFile(join(BUILD, "neon", `${e.id}-script.json`), "utf8"));
export const blogSlug = (e: Episode) => `/git-gud-${e.id}`;
export const videoTitle = (e: Episode) => `Git Gud ${two(numberOf(e))}: ${e.title}`;

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

async function description(e: Episode, uploaded: Uploaded): Promise<string> {
  const n = numberOf(e);
  const p = await placed(e);
  // YouTube chapters: the first at 0:00, each at least ten seconds long.
  const chapters: { at: number; title: string }[] = [];
  for (const section of p.sections) {
    const at = chapters.length === 0 ? 0 : Math.max(0, section.lines[0]!.at / FPS - 0.4);
    if (chapters.length && at - chapters.at(-1)!.at < 10) continue;
    chapters.push({ at, title: section.title });
  }
  const neighbour = (offset: number) => {
    const other = all[n - 1 + offset];
    if (!other) return null;
    const id = uploaded[other.id]?.videoId;
    return `${offset < 0 ? "Previous" : "Next"}: ${videoTitle(other)}${id ? ` https://youtu.be/${id}` : ""}`;
  };
  return [
    `${e.subtitle}. Episode ${n} of ${all.length} in a tour of Git Gud, a desktop Git client with a lane-colored commit graph, a headless daemon, a relay and a phone app.`,
    "",
    ...e.sections.map((s) => `• ${s.title}`),
    "",
    "Chapters",
    ...chapters.map((c) => `${clock(c.at)} ${c.title}`),
    "",
    `Write-up: ${BLOG}${blogSlug(e)}`,
    `Git Gud on GitHub: ${REPO}`,
    `Download: ${REPO}/releases/latest`,
    "",
    ...[neighbour(-1), neighbour(1)].filter(Boolean),
    "",
    "Everything on screen is the real app, driven by a script against a demo repository. The narration is a synthetic voice (Kokoro).",
  ].join("\n");
}

const tags = (e: Episode) => ["Git Gud", "git", "git client", "git GUI", "developer tools", "Electron", e.title, e.subtitle].join(",");

if (command === "descriptions") {
  // Rewrite every uploaded episode's description, so Previous and Next link to the videos once all exist.
  const uploaded: Uploaded = JSON.parse(await readFile(RECORD, "utf8"));
  await mkdir(join(BUILD, "youtube"), { recursive: true });
  const out: Record<string, string> = {};
  for (const e of chosen) if (uploaded[e.id]) out[uploaded[e.id]!.videoId] = await description(e, uploaded);
  await writeFile(join(BUILD, "youtube", "descriptions.json"), JSON.stringify(out, null, 2));
  process.stdout.write(`${Object.keys(out).length} descriptions → build/youtube/descriptions.json\n`);
} else if (command === "describe") {
  const uploaded: Uploaded = existsSync(RECORD) ? JSON.parse(await readFile(RECORD, "utf8")) : {};
  for (const e of chosen) process.stdout.write(`${videoTitle(e)}\n\n${await description(e, uploaded)}\n\n`);
} else if (command === "thumbs") {
  await mkdir(join(BUILD, "thumbs"), { recursive: true });
  for (const e of chosen) {
    neon("project", "open", project(e));
    neon("packs", "install", join(VIDEO, "fx", "gitgud-fx"));
    const state = neon<{ layers: { id: string }[] }>("api", "GET", "thumbnail");
    if (state.layers.length) neon("thumbnail", "remove", ...state.layers.map((l) => l.id));
    // The background: the episode partway through the line named in thumbFrom.
    const [s, l] = e.youtube.thumbFrom.split(".").map(Number);
    const line = (await placed(e)).sections[s! - 1]!.lines[l! - 1]!;
    neon("thumbnail", "background", "--at", `${line.at + Math.round(line.duration * 0.7)}f`);
    neon("thumbnail", "add", "--component", "GitGudThumbnail", "--props", JSON.stringify({ number: numberOf(e), title: e.youtube.thumbTitle, kicker: e.youtube.thumbKicker }), "--pos", "0.5,0.5", "--scale", "1");
    const out = join(BUILD, "thumbs", `${e.id}.png`);
    neon("thumbnail", "render", "--out", out);
    neon("project", "save");
    process.stdout.write(`${out}\n`);
  }
} else if (command === "upload") {
  const privacy = process.env.PRIVACY ?? "public";
  const uploaded: Uploaded = existsSync(RECORD) ? JSON.parse(await readFile(RECORD, "utf8")) : {};
  for (const e of chosen) {
    if (uploaded[e.id]) {
      process.stdout.write(`skip ${e.id}: already ${uploaded[e.id]!.url}\n`);
      continue;
    }
    const notes = join(BUILD, "youtube", `${e.id}.md`);
    await mkdir(join(BUILD, "youtube"), { recursive: true });
    await writeFile(notes, await description(e, uploaded));
    const job = neon<{ videoId?: string; url?: string; warnings?: string[]; status?: string }>(
      "youtube", "upload", join(BUILD, "renders", `${e.id}.mp4`),
      "--title", videoTitle(e), "--no-kids", "--privacy", privacy,
      "--description-file", notes, "--tags", tags(e), "--thumbnail", join(BUILD, "thumbs", `${e.id}.png`),
    );
    const videoId = job.videoId ?? /(?:v=|youtu\.be\/)([\w-]{11})/.exec(job.url ?? "")?.[1];
    if (!videoId) throw new Error(`Upload of ${e.id} returned no video id: ${JSON.stringify(job)}`);
    uploaded[e.id] = { videoId, url: `https://youtu.be/${videoId}`, title: videoTitle(e), privacy, uploadedAt: new Date().toISOString() };
    await writeFile(RECORD, `${JSON.stringify(uploaded, null, 2)}\n`);
    process.stdout.write(`${e.id} → https://youtu.be/${videoId}${job.warnings?.length ? `  warnings: ${job.warnings.join("; ")}` : ""}\n`);
  }
} else {
  throw new Error("usage: youtube.ts thumbs|upload|describe [episode...]");
}
