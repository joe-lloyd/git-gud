// Writes one dev-blog post per episode into a my-dev-blog checkout.
//
//   node video/tools/blog.ts <path-to-my-dev-blog>
//
// Each post is the episode's narration as prose under its section headings, the episode's video
// (from youtube.json), its thumbnail as the featured image, and links to the rest of the series.
import { existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { episodes } from "./episodes.mjs";

const VIDEO = join(import.meta.dirname, "..");
const blog = process.argv[2];
if (!blog || !existsSync(join(blog, "content", "posts"))) throw new Error("usage: blog.ts <path-to-my-dev-blog>");

type Line = { say: string; fx?: { name: string; props: Record<string, string> } };
type Episode = { id: string; title: string; subtitle: string; blog?: { excerpt?: string }; sections: { title: string; lines: Line[] }[] };
const all: Episode[] = await episodes();
const uploaded: Record<string, { videoId: string }> = existsSync(join(VIDEO, "youtube.json")) ? JSON.parse(await readFile(join(VIDEO, "youtube.json"), "utf8")) : {};
const DATE = process.env.POST_DATE ?? new Date().toISOString().slice(0, 10);
const two = (n: number) => String(n).padStart(2, "0");
const slug = (e: Episode) => `/git-gud-${e.id}`;
const mdx = (text: string) => text.replace(/[{}<>]/g, (c) => `\\${c}`);

/** The narration spells some things the way they're said; the post shows them the way they're written. */
const WRITTEN: [RegExp, string][] = [
  [/\bfeature metric default\b/g, "`feature/metric-default`"],
  [/\bfeature hourly forecast\b/g, "`feature/hourly-forecast`"],
  [/\bunits dot J S\b/g, "`src/units.js`"],
  [/\bforecast dot T S\b/g, "`src/forecast.ts`"],
  [/\ba dot gitreview file\b/g, "a `.gitreview` file"],
  [/\brefs for main\b/g, "`refs/for/main`"],
  [/\bH MAC\b/g, "HMAC"],
  [/\bQ R\b/g, "QR"],
  [/\bCommand Enter\b/g, "⌘Enter"],
  [/\bCommand F\b/g, "⌘F"],
  [/\bseventy to a hundred and eighty percent\b/g, "70% to 180%"],
  [/\bversion one point zero\b/g, "v1.0.0"],
  [/^Watch\. /, ""],
];
const written = (text: string) => WRITTEN.reduce((t, [pattern, to]) => t.replace(pattern, to), text);
const quote = (text: string) => JSON.stringify(text);

/** The cards in an episode list things the narration only names; show them as a list. */
function cardList(fx: Line["fx"]): string {
  if (!fx || fx.name !== "GitGudCard" || !fx.props.items) return "";
  const rows = fx.props.items.split("\n").map((row) => row.split("|").map((x) => x.trim()));
  return `\n\n${rows.map(([, label, detail]) => `- **${mdx(label!)}**: ${mdx(detail!)}`).join("\n")}\n`;
}

for (const [index, e] of all.entries()) {
  const n = index + 1;
  const thumb = join(VIDEO, "build", "thumbs", `${e.id}.png`);
  const image = `git-gud-${two(n)}.png`;
  if (existsSync(thumb)) await copyFile(thumb, join(blog, "content", "images", "thumbnails", image));
  // Search engines show about 155 characters; cut at a word.
  const firstLines = written(e.sections[0]!.lines[0]!.say).replace(/`/g, "");
  const excerpt = e.blog?.excerpt ?? `${e.subtitle}. Episode ${n} of ${all.length} in the Git Gud video tour.`;
  const body = e.sections
    .map((section, s) => {
      const paragraphs = section.lines.map((line) => mdx(written(line.say)) + cardList(line.fx)).join("\n\n");
      return s === 0 ? paragraphs : `## ${mdx(section.title)}\n\n${paragraphs}`;
    })
    .join("\n\n");
  const prev = all[index - 1];
  const next = all[index + 1];
  const series = all.map((other, i) => (other === e ? `${i + 1}. **${mdx(other.title)}** (this post)` : `${i + 1}. [${mdx(other.title)}](${slug(other)})`)).join("\n");
  const post = `---
title: ${quote(`Git Gud ${two(n)}: ${e.title}`)}
author: "Joe"
date: "${DATE}"
slug: "${slug(e)}"
excerpt: ${quote(excerpt)}
featuredImage: ../images/thumbnails/${image}
tags: ["git gud", "git", "electron", "developer tools", "video"]
seoTitle: ${quote(`Git Gud ${two(n)}: ${e.title}. ${e.subtitle}`)}
seoDescription: ${quote(`${excerpt} ${firstLines}`.replace(/^(.{0,155})\s.*$/s, "$1"))}
published: true
videoId: "${uploaded[e.id]?.videoId ?? ""}"
gistLink: ""
gitHubLink: "https://github.com/joe-lloyd/git-gud"
---

*Episode ${n} of ${all.length} in a video tour of [Git Gud](https://github.com/joe-lloyd/git-gud), a desktop Git client with a lane-colored commit graph. The video is above; this is what it says, with the details.*

${body}

---

${[prev ? `Previous: [${mdx(prev.title)}](${slug(prev)})` : "", next ? `Next: [${mdx(next.title)}](${slug(next)})` : ""].filter(Boolean).join(" · ")}

### The series

${series}

Git Gud is open source. Get it from the [latest release](https://github.com/joe-lloyd/git-gud/releases/latest), or read [every feature in one list](https://github.com/joe-lloyd/git-gud/blob/main/docs/feature-list.md).
`;
  await writeFile(join(blog, "content", "posts", `git-gud-${e.id}.mdx`), post);
  process.stdout.write(`${slug(e)}\n`);
}
