import { launchGitGud } from "../app.ts";
import type { TakeFn } from "../record.ts";
import { callout, hideConsole, row, zoomTo } from "./lib.ts";

export const takes: Record<string, TakeFn> = {
  async graph(ctx) {
    const repo = ctx.demo();
    const { app, page } = await launchGitGud({ userData: `${ctx.work}/ud`, tabs: [repo] });
    ctx.defer(() => app.close());
    await page.locator(".commit-row").first().waitFor();
    await hideConsole(page);
    const pill = (name: string) => page.locator(".ref-pill", { hasText: name }).first();
    const t = await ctx.take("graph", page);

    await t.line("1.1", async () => {
      await t.moveTo(page.locator(".graph-canvas-wrap"));
      await zoomTo(t, page.locator(".graph-canvas-wrap"), 5, 1.3);
    });
    await t.line("1.2", async () => {
      await t.cue("main");
      await callout(t, pill("main"), "main", 2.5);
      await t.moveTo(pill("main"));
      await t.cue("purple");
      await callout(t, pill("feature/hourly-forecast"), "feature/hourly-forecast", 3);
      await t.moveTo(row(page, "grid layout").locator(".cr-message"));
      await t.cue("branched");
      await t.moveTo(row(page, "first cut of the hourly").locator(".cr-message"));
    });
    await t.line("1.3", async () => {
      await t.moveTo(page.locator(".graph-rows"));
      for (let i = 0; i < 5; i++) {
        await page.mouse.wheel(0, 110);
        await t.pause(0.25);
      }
      await t.cue("merges");
      await callout(t, row(page, "Merge branch 'feature/dark-mode'").locator(".cr-message"), "Merge commits", 3);
      await t.moveTo(row(page, "Merge branch 'feature/dark-mode'").locator(".cr-message"));
    });
    await t.line("1.4", async () => {
      await page.mouse.wheel(0, -2000);
      await t.pause(0.6);
      await callout(t, page.locator(".commit-row.is-pseudo .cr-message"), "Uncommitted changes", 3.5);
      await t.moveTo(page.locator(".commit-row.is-pseudo .cr-message"));
    });
    await t.line("1.5", async () => {
      await t.cue("diamond");
      await callout(t, page.locator(".commit-row.is-stash .cr-message"), "A stash", 3);
      await t.moveTo(page.locator(".commit-row.is-stash .cr-message"));
    });

    await t.line("2.1", async () => {
      await t.cue("filled");
      await t.moveTo(page.locator(".ref-head").first());
      await zoomTo(t, page.locator(".ref-head").first(), 6, 1.8);
      await t.cue("icons");
      await t.moveTo(pill("feature/hourly-forecast"));
    });
    await t.line("2.2", async () => {
      await t.cue("plus");
      await t.moveTo(page.locator(".ref-more").first());
      await t.pause(1.2);
    });
    await t.line("2.3", async () => {
      await t.click(page.locator(".tb-refs"));
      await t.cue("Switch");
      await t.click(page.locator(".tb-refs-menu label", { hasText: "Local branches" }));
      await t.moveTo({ x: 320, y: 300 });
      await t.cue("back");
      await t.click(page.locator(".tb-refs-menu label", { hasText: "Local branches" }));
      await t.pause(0.8);
      await page.keyboard.press("Escape");
      await page.mouse.click(700, 770);
    });
    await t.line("3.1", async () => {
      await t.click(row(page, "share one rounding helper").locator(".cr-message"));
      await t.cue("file");
      await t.moveTo(page.locator(".cd-files"));
    });
    await t.line("3.2", async () => {
      await t.click(page.locator(".cd-file-item").first());
      await t.cue("Escape");
      t.keys("Esc");
      await page.keyboard.press("Escape");
    });
    await t.line("3.3", async () => {
      await t.click(row(page, "share one rounding helper").locator(".cr-message"));
      for (let i = 0; i < 4; i++) {
        t.keys("↓");
        await page.keyboard.press("ArrowDown");
        await t.pause(0.7);
      }
      t.keys("↑");
      await page.keyboard.press("ArrowUp");
    });
    await t.line("3.4", async () => {
      await t.cue("Shift-click");
      await t.click(row(page, "list of favourite stations").locator(".cr-message"));
      await t.click(row(page, "changelog for 1.2.0").locator(".cr-message"), { modifiers: ["Shift"] });
      await t.cue("Command-click");
      await t.click(row(page, "cache station responses").locator(".cr-message"), { modifiers: ["Meta"] });
    });
    await t.line("3.5", async () => {
      await t.moveTo(page.locator(".right-panel"));
      await callout(t, page.locator(".right-panel"), "Count, authors, combined diffstat", 3.5);
    });

    await t.line("4.1", async () => {
      await page.keyboard.press("Escape");
      await page.mouse.click(700, 770);
      t.keys("Cmd+F");
      await page.keyboard.press("Meta+f");
      await t.type(page.locator(".search-input"), "units", 120);
    });
    await t.line("4.2", async () => {
      await t.moveTo(page.locator('[aria-label="Search commits"]'));
      for (let i = 0; i < 3; i++) {
        await t.pause(0.9);
        t.keys("Enter");
        await page.keyboard.press("Enter");
      }
    });
    await t.line("4.3", async () => {
      await t.click(page.locator(".search-mode", { hasText: "Content" }));
      await page.locator(".search-input").fill("");
      await t.type(page.locator(".search-input"), "FEET_PER_METRE", 90);
    });
    await t.line("4.4", async () => {
      await t.pause(0.6);
      t.keys("Enter");
      await page.keyboard.press("Enter");
      await t.pause(1.5);
      t.keys("Enter");
      await page.keyboard.press("Enter");
    });
    await t.line("4.5", async () => {
      await t.pause(1);
      await page.keyboard.press("Escape");
    });
    await t.finish();
  },
};
