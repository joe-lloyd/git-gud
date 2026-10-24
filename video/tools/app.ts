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
  await app.evaluate(({ BrowserWindow, dialog }, picks) => {
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
