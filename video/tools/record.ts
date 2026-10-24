// Records the takes of the tutorial against the real app, real peers and the real daemon.
//
//   pnpm build && pnpm build:headless && pnpm build:relay
//   node video/tools/voice.mjs
//   node video/tools/record.ts [episode[:take]...]      # no arguments records everything
//
// Each episode's takes live in tools/takes/<episode>.ts. A take lands in
// video/build/takes/<episode>/<take>.mp4 plus <take>.json with each line's start time.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Page } from "playwright-core";
import { Take, type VoLine } from "./director.ts";
import { VIEWPORT } from "./app.ts";

const VIDEO = join(dirname(fileURLToPath(import.meta.url)), "..");

export type Ctx = {
  episode: string;
  /** A fresh scratch folder for this take, removed afterwards. */
  work: string;
  /** Builds a fresh copy of the demo repos under `/Users/Shared/<dir>` and returns the tidepool path. */
  demo(name?: string): string;
  /** Starts a take on `page`; finish it with `take.finish()`. */
  take(name: string, page: Page, opts?: { touch?: boolean }): Promise<Take>;
  /** Registered cleanups run after the take, even when it fails. */
  defer(fn: () => unknown): void;
};

export type TakeFn = (ctx: Ctx) => Promise<void>;

const wanted = process.argv.slice(2);
const episodeFiles = (await readdir(join(VIDEO, "tools", "takes"))).filter((f) => /^\d\d-.*\.ts$/.test(f)).sort();

for (const file of episodeFiles) {
  const episode = file.replace(/\.ts$/, "");
  const takes: Record<string, TakeFn> = (await import(pathToFileURL(join(VIDEO, "tools", "takes", file)).href)).takes;
  const manifestFile = join(VIDEO, "build", "vo", episode, "manifest.json");
  if (!existsSync(manifestFile)) throw new Error(`No narration for ${episode}; run voice.mjs first`);
  const vo = new Map<string, VoLine>(JSON.parse(await readFile(manifestFile, "utf8")).lines.map((l: VoLine) => [l.id, l]));
  // Pre-flight: every t.cue("word") must name a word of its line, or the take dies minutes in.
  const source = await readFile(join(VIDEO, "tools", "takes", file), "utf8");
  const problems: string[] = [];
  for (const block of source.split(/\b\w\.line\("/).slice(1)) {
    const lineId = block.slice(0, block.indexOf('"'));
    const line = vo.get(lineId);
    if (!line) {
      problems.push(`${lineId}: no such line`);
      continue;
    }
    const spoken = line.words.map((w) => w.word.toLowerCase().replace(/[^a-z0-9-]/g, ""));
    for (const [, word, nth] of block.matchAll(/\b\w\.cue\("([^"]+)"(?:,\s*(\d+))?\)/g)) {
      if (spoken.filter((w) => w === word!.toLowerCase()).length < Number(nth ?? 1)) problems.push(`${lineId}: no "${word}" in "${line.say}"`);
    }
  }
  if (problems.length) throw new Error(`${episode} cues:\n  ${problems.join("\n  ")}`);
  const out = join(VIDEO, "build", "takes", episode);
  await mkdir(out, { recursive: true });
  for (const [name, fn] of Object.entries(takes)) {
    const selected = wanted.length === 0 || wanted.includes(episode) || wanted.includes(`${episode}:${name}`);
    if (!selected) continue;
    process.stdout.write(`▶ ${episode}:${name}\n`);
    // The real path: macOS links /var and /tmp into /private, and git reports the resolved one.
    const work = await realpath(await mkdtemp(join(tmpdir(), `gg-video-${name}-`)));
    const cleanups: (() => unknown)[] = [];
    const pages: Page[] = [];
    const ctx: Ctx = {
      episode,
      work,
      demo(dir = "code") {
        // A short, believable path, because the start page and the console show it.
        const root = join("/Users/Shared", dir);
        cleanups.push(() => rm(root, { recursive: true, force: true }));
        execFileSync("bash", [join(VIDEO, "demo", "build-demo.sh"), root], { stdio: "ignore" });
        return join(root, "tidepool");
      },
      async take(takeName, page, opts = {}) {
        pages.push(page);
        const take = new Take(takeName, page, vo, { outDir: out, viewport: VIEWPORT, touch: opts.touch });
        await take.start();
        return take;
      },
      defer(fn) {
        cleanups.push(fn);
      },
    };
    try {
      // A hung take fails instead of blocking the run; no take is longer than a few minutes.
      let timer: NodeJS.Timeout | undefined;
      const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${episode}:${name} ran over 8 minutes`)), 8 * 60_000); });
      await Promise.race([fn(ctx), limit]).finally(() => clearTimeout(timer));
    } catch (error) {
      // What the screen showed when the take broke is usually the whole story.
      const debug = join(VIDEO, "build", "debug");
      await mkdir(debug, { recursive: true });
      for (const [i, page] of pages.entries()) await page.screenshot({ path: join(debug, `${episode}-${name}-${i}.png`) }).catch(() => {});
      throw error;
    } finally {
      for (const fn of cleanups.reverse()) await Promise.resolve(fn()).catch(() => {});
      await rm(work, { recursive: true, force: true });
    }
  }
}
