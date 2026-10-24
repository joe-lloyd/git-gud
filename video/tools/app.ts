// Launches Git Gud for a take: a dev build with its own user data, a 1440×810 window, and native
// folder pickers answered by the take instead of a dialog nobody can click.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const VIEWPORT = { width: 1440, height: 810 };

export type Launch = {
  /** Folder for this instance's user data. Two instances need two folders. */
  userData: string;
  /** Repos listed on the start page, newest first. */
  recent?: string[];
  /** Repos open as tabs on launch; the first is active. */
  tabs?: string[];
  /** What the folder picker returns, in order of the calls. */
  picks?: string[];
  env?: NodeJS.ProcessEnv;
};

export async function launchGitGud(opts: Launch): Promise<{ app: ElectronApplication; page: Page }> {
  await mkdir(opts.userData, { recursive: true });
  await writeFile(join(opts.userData, "recent-projects.json"), JSON.stringify(opts.recent ?? opts.tabs ?? []));
  const tabs = (opts.tabs ?? []).map((p) => ({ main: p, worktree: p }));
  await writeFile(join(opts.userData, "open-tabs.json"), JSON.stringify({ tabs, active: opts.tabs?.[0] ?? null }));
  const app = await electron.launch({
    args: [REPO, "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
    cwd: REPO,
    env: { ...process.env, GITGUD_USER_DATA: opts.userData, ...opts.env },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow, dialog, shell }, picks) => {
    // A take never opens the real browser.
    shell.openExternal = async () => {};
    const window = BrowserWindow.getAllWindows()[0];
    window?.setContentSize(1440, 810);
    window?.center();
    const queue = [...picks];
    dialog.showOpenDialog = (async () => {
      const next = queue.shift();
      return next ? { canceled: false, filePaths: [next] } : { canceled: true, filePaths: [] };
    }) as typeof dialog.showOpenDialog;
  }, opts.picks ?? []);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  return { app, page };
}

/** Feeds the next folder picker answers to a running instance. */
export function pick(app: ElectronApplication, ...paths: string[]) {
  return app.evaluate(({ dialog }, picks) => {
    const queue = [...picks];
    dialog.showOpenDialog = (async () => {
      const next = queue.shift();
      return next ? { canceled: false, filePaths: [next] } : { canceled: true, filePaths: [] };
    }) as typeof dialog.showOpenDialog;
  }, paths);
}

/** A signed-in GitHub account for the camera: answers the GitHub IPC calls without touching GitHub. */
export function fakeGitHub(app: ElectronApplication) {
  return app.evaluate(({ ipcMain }) => {
    const avatar = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#ff4fc3"/><text x="32" y="41" font-family="Inter,sans-serif" font-size="24" font-weight="700" text-anchor="middle" fill="#1a0f17">AR</text></svg>')}`;
    const user = { login: "alex-rivera", name: "Alex Rivera", avatar_url: avatar };
    let signedIn = false;
    let polls = 0;
    const repo = (name: string) => ({ name, full_name: `alex-rivera/${name}`, html_url: `https://github.com/alex-rivera/${name}`, ssh_url: `git@github.com:alex-rivera/${name}.git`, clone_url: `https://github.com/alex-rivera/${name}.git` });
    const handle = (channel: string, fn: (...args: unknown[]) => unknown) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (_e, ...args) => fn(...args));
    };
    handle("github:get-user", () => (signedIn ? user : null));
    handle("github:start-device-flow", () => ({ success: true, flow: { device_code: "demo", user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", interval: 1 } }));
    // The second poll succeeds, as if the code was approved in the browser.
    handle("github:poll-token", () => (++polls >= 3 ? ((signedIn = true), { success: true, user }) : { success: false, error: "authorization_pending" }));
    handle("github:logout", () => ((signedIn = false), true));
    handle("github:list-repos", () => ({ success: true, repos: ["tidepool", "surf-report", "dotfiles", "moon-phase", "harbor-cam"].map(repo) }));
  });
}
