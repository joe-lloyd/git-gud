import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { _electron as electron } from "playwright-core";
import { REPO, launchGitGud } from "../app.ts";
import type { TakeFn } from "../record.ts";
import { callout, onlyBuildBox } from "./lib.ts";

const VIDEO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DAEMON = join(REPO, "out", "headless", "main.js");
// Not 47831: a real gitgud-headless may already be serving on this machine.
const PORT = 47851;

export const takes: Record<string, TakeFn> = {
  async headless(ctx) {
    const repo = ctx.demo();
    const env = { ...process.env, GITGUD_HEADLESS_HOME: join(ctx.work, "ghd"), NO_COLOR: undefined };
    const run = (...args: string[]) => execFileSync("node", [DAEMON, ...args], { env, encoding: "utf8" });

    // ── Real daemon output, captured first and replayed in the terminal take ──
    const out: Record<string, string> = {};
    out.init = run("init", "--writable", "--bind", "en0", "--repo", repo);
    const configFile = /(\/\S+config\.jsonc)/.exec(out.init)?.[1] ?? run("status").match(/(\/\S+config\.jsonc)/)?.[1];
    if (!configFile) throw new Error(`No config path in:\n${out.init}`);
    const config = readFileSync(configFile, "utf8").replace(/"port":\s*\d+/, `"port": ${PORT}`);
    // Named like a server, not after this Mac's hostname.
    writeFileSync(configFile, /"name":/.test(config) ? config.replace(/"name":\s*"[^"]*"/, '"name": "build-box"') : config.replace("{", '{\n  "name": "build-box",'));
    const daemon: ChildProcess = spawn("node", [DAEMON, "serve"], { env });
    ctx.defer(() => daemon.kill());
    let serveOut = "";
    daemon.stdout?.on("data", (d: Buffer) => (serveOut += d.toString()));
    daemon.stderr?.on("data", (d: Buffer) => (serveOut += d.toString()));
    await new Promise((r) => setTimeout(r, 3000));
    out.serve = serveOut;
    out.pair = run("pair", "--qr");
    const payload = /(gitgud-peer:\/\/pair\?\S+)/.exec(out.pair)?.[1];
    if (!payload) throw new Error(`No pairing payload in:\n${out.pair}`);

    // ── The desktop pairs with it ──
    const { app, page } = await launchGitGud({ userData: `${ctx.work}/ud`, recent: [] });
    ctx.defer(() => app.close());
    await page.evaluate(() => (window as unknown as { peerApi: { setServer: (p: object) => Promise<unknown> } }).peerApi.setServer({ name: "laptop", enabled: false }));
    await onlyBuildBox(page);
    const modal = page.locator(".peer-modal");
    const d = await ctx.take("headless-desktop", page);
    await d.line("3.1", async () => {
      await d.click(page.getByRole("button", { name: /Connect to a Peer/ }));
      await d.click(modal.getByText("Connect by address"));
      await d.cue("paste");
      const field = modal.getByPlaceholder(/pairing payload|gitgud-peer/);
      await d.click(field);
      await field.fill(payload);
      await page.keyboard.press("Enter");
    });
    await d.line("3.2", async () => {
      await d.click(modal.locator(".peer-rail").getByText("build-box").first());
      const repoButton = modal.locator(".peer-repo").first();
      await repoButton.waitFor({ timeout: 20000 });
      await d.cue("repositories");
      await callout(d, repoButton, "Served by gitgud-headless", 3);
      await d.click(repoButton);
      await page.locator(".commit-row").first().waitFor({ timeout: 30000 });
    });
    await d.finish();

    out.devices = run("devices");
    const peer8 = /\b([0-9a-f]{8})/.exec(out.devices)?.[1];
    if (!peer8) throw new Error(`No device id in:\n${out.devices}`);
    out.allow = run("allow", peer8, "fetch,pull");
    out.audit = run("audit", "-n", "6");
    writeFileSync(join(ctx.work, "outputs.json"), JSON.stringify(out, null, 2));

    // ── The terminal take replays it ──
    const shell = await electron.launch({
      args: [join(VIDEO, "tools", "stage-shell.cjs")],
      env: { ...process.env, STAGE_URL: pathToFileURL(join(VIDEO, "stage", "terminal.html")).href, STAGE_USER_DATA: join(ctx.work, "stage-term") },
    });
    ctx.defer(() => shell.close());
    const term = await shell.firstWindow();
    await term.waitForTimeout(800);
    const say = (fn: string, ...args: unknown[]) => term.evaluate(([f, a]) => (window as unknown as { term: Record<string, (...x: unknown[]) => Promise<void>> }).term[f as string]!(...(a as unknown[])), [fn, args] as const);
    const command = async (cmd: string, output: string, lineMs = 25) => {
      await say("type", cmd, 34);
      // This Mac stands in for the build box, so its hostname reads as one.
      await say("print", output.replace(new RegExp(ctx.work, "g"), "~").replace(/stunseeackwards/g, "build-box"), lineMs);
      await say("prompt");
    };
    const t = await ctx.take("terminal", term);
    await t.line("2.1", async () => {
      await say("type", "curl -fsSL https://raw.githubusercontent.com/joe-lloyd/git-gud/main/scripts/install-headless.sh | bash", 18);
      await say("print", "# installs ~/.local/bin/gitgud-headless and a systemd user unit (gitgud-headless.service)");
      await say("prompt");
      await t.cue("init");
      await command(`gitgud-headless init --writable --bind en0 --repo ${repo}`, out.init!);
    });
    await t.line("2.2", async () => {
      await t.cue("writable");
      t.zoom([0.4, 0.35], 4, 1.4);
    });
    await t.line("2.3", async () => {
      await say("clear");
      await command("gitgud-headless serve", out.serve!, 60);
      await t.cue("fingerprint");
    });
    await t.line("2.4", async () => {
      await say("clear");
      await command("gitgud-headless pair --qr", out.pair!, 18);
    });
    await t.line("4.1", async () => {
      await say("clear");
      await command("gitgud-headless devices", out.devices!);
    });
    await t.line("4.2", async () => {
      await command(`gitgud-headless allow ${peer8} fetch,pull`, out.allow!);
    });
    await t.line("4.3", async () => {
      await say("clear");
      await command("gitgud-headless audit -n 6", out.audit!, 40);
    });
    await t.finish();
  },
};
