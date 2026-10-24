// Regression check for the blank-graph bug: crashes Chromium's GPU process while the graph is open,
// so the graph canvas loses and regains its context, and asserts the lanes are drawn again afterwards. Prints PASS or FAIL with the canvas's painted-pixel counts.
//   node video/tools/canvas-restore-check.ts
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchGitGud } from "./app.ts";
import { Take } from "./director.ts";

const work = await realpath(await mkdtemp(join(tmpdir(), "gg-canvas-")));
execFileSync("bash", [join(import.meta.dirname, "..", "demo", "build-demo.sh"), join(work, "demo")], { stdio: "ignore" });
const repo = join(work, "demo", "tidepool");
const { app, page } = await launchGitGud({ userData: join(work, "ud"), recent: [repo], picks: [repo] });
const events: string[] = [];
page.on("console", (m) => m.text().startsWith("CANVAS ") && events.push(m.text().slice(7)));
const painted = () => page.evaluate(() => {
  const c = document.querySelector("canvas.graph-canvas") as HTMLCanvasElement;
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let j = 3; j < d.length; j += 4) if (d[j]! > 0) n++;
  return n;
});
const t = new Take("canvas-check", page, new Map(), { outDir: work, viewport: { width: 1440, height: 810 } });
await t.start();
await t.click(page.getByRole("button", { name: "Open Repository" }));
await page.locator(".commit-row").first().waitFor();
await page.waitForTimeout(1000);
const before = await painted();
await t.click(page.locator(".tab-home"));
await t.click(page.getByRole("button", { name: /tidepool/ }).first());
await page.locator(".commit-row").first().waitFor();
await page.evaluate(() => {
  const c = document.querySelector("canvas.graph-canvas")!;
  for (const e of ["contextlost", "contextrestored"]) c.addEventListener(e, () => console.log(`CANVAS ${e}`));
});
// Crash the GPU process, the way a driver reset or memory pressure does. Chromium drops every
// canvas backing store and restores it blank.
await app.evaluate(({ BrowserWindow }) => {
  const crasher = new BrowserWindow({ show: false });
  crasher.loadURL("chrome://gpucrash").catch(() => {});
  setTimeout(() => crasher.destroy(), 3000);
});
await page.waitForTimeout(4000);
for (const i of [0, 1, 2]) await t.moveTo(page.locator(".sb-section-label").nth(i));
await page.waitForTimeout(1500);
const after = await painted();
await app.close();
// Without a context loss the check proves nothing, so that counts as a failure too.
const ok = before > 0 && after > 0 && events.includes("contextrestored");
console.log(`${ok ? "PASS" : "FAIL"} painted before=${before} after=${after} events=${events.join(",") || "none"}`);
process.exit(ok ? 0 : 1);
