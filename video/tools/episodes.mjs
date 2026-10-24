// The series: every file in video/episodes, in name order. The file name (without .json) is the episode id.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "episodes");

export async function episodes() {
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(files.map(async (f) => ({ id: f.replace(/\.json$/, ""), ...JSON.parse(await readFile(join(DIR, f), "utf8")) })));
}
