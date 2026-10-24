import { launchGitGud } from "../app.ts";
import type { TakeFn } from "../record.ts";
import { callout, hideConsole, closeSettings } from "./lib.ts";

export const takes: Record<string, TakeFn> = {
  async settings(ctx) {
    const repo = ctx.demo();
    const { app, page } = await launchGitGud({ userData: `${ctx.work}/ud`, tabs: [repo] });
    ctx.defer(() => app.close());
    await page.locator(".commit-row").first().waitFor();
    await hideConsole(page);
    const settings = page.locator(".modal-panel", { hasText: "Text size" });
    const row = (text: string) => settings.getByText(text, { exact: true }).first();
    // The auto-updater's own events, with a pretend release, so the update UI shows without a real one.
    const updater = (channel: string, payload: unknown) =>
      app.evaluate(({ BrowserWindow }, [c, p]) => BrowserWindow.getAllWindows()[0]?.webContents.send(c as string, p), [channel, payload] as const);
    const t = await ctx.take("settings", page);

    await t.line("1.1", async () => {
      await t.click(page.getByTitle("Settings"));
      await t.cue("Text");
      const larger = settings.getByTitle("Larger");
      await t.click(larger);
      await t.click(larger);
      await t.cue("eighty");
      await t.click(settings.getByTitle("Reset to 100%"));
    });
    await t.line("1.2", async () => {
      // The switch is the label next to the setting's name (the input itself is styled away).
      const box = row("High contrast").locator("xpath=../..").locator("label").first();
      await t.click(box);
      await t.pause(1.6);
      await t.click(box);
    });
    await t.line("1.3", async () => {
      await t.moveTo(row("Auto-fix blocked actions"));
      await t.cue("reuse");
      await t.moveTo(row("Reuse recorded conflict resolutions"));
    });
    await t.line("1.4", async () => {
      await t.moveTo(row("Gerrit mode"));
    });
    await t.line("1.5", async () => {
      await t.moveTo(row("Share with other Git Gud instances"));
    });
    await t.line("2.1", async () => {
      const channel = settings.locator("select").first();
      await t.cue("Stable");
      await t.moveTo(channel);
      await t.cue("Dev");
      await callout(t, channel, "Stable or Dev (pre-release)", 3);
    });
    await t.line("2.2", async () => {
      await closeSettings(page);
      await t.cue("button");
      await updater("updater:status", { state: "available", version: "1.22.0" });
      for (const percent of [12, 38, 64, 91]) {
        await updater("updater:progress", { percent });
        await t.pause(0.5);
      }
      await updater("updater:status", { state: "downloaded", version: "1.22.0" });
      await t.cue("restart");
      await callout(t, page.locator(".tab-version"), "Restart into the new version", 3);
      await t.moveTo(page.locator(".tab-version"));
    });
    await t.line("2.3", async () => {
      await updater("updater:status", { state: "none" });
      await t.moveTo(page.locator(".tab-version"));
    });
    await t.finish();
  },
};
