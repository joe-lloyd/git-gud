import { launchGitGud } from "../app.ts";
import type { TakeFn } from "../record.ts";
import { callout, row, sweep, zoomTo } from "./lib.ts";

export const takes: Record<string, TakeFn> = {
  async tour(ctx) {
    const repo = ctx.demo();
    const { app, page } = await launchGitGud({ userData: `${ctx.work}/ud`, recent: [repo], picks: [repo] });
    ctx.defer(() => app.close());
    await page.getByRole("button", { name: "Open Repository" }).waitFor();
    const t = await ctx.take("tour", page);

    await t.line("2.1", async () => {
      await t.cue("Open");
      const open = page.getByRole("button", { name: "Open Repository" });
      await callout(t, open, "Open Repository", 2.5);
      await t.click(open);
      await page.locator(".commit-row").first().waitFor();
    });
    await t.line("2.2", async () => {
      await callout(t, page.locator(".tab.active"), "One tab per repository", 2.5);
      await t.moveTo(page.locator(".tab.active"));
      await t.cue("home");
      await t.click(page.locator(".tab-home"));
      await t.cue("recent");
      await t.moveTo(page.getByRole("button", { name: /tidepool/ }).first());
    });
    await t.line("2.3", async () => {
      await t.click(page.getByRole("button", { name: /tidepool/ }).first());
      await page.locator(".commit-row").first().waitFor();
    });

    await t.line("3.1", async () => {
      await t.moveTo(page.locator(".graph-rows"));
      await zoomTo(t, page.locator(".graph-view"), 4, 1.25);
    });
    await t.line("3.2", async () => {
      await t.cue("branches");
      await sweep(t, [page.locator(".sb-section-label").nth(0), page.locator(".sb-section-label").nth(1), page.locator(".sb-section-label").nth(2)], 0.6);
    });
    await t.line("3.3", async () => {
      await t.cue("bisect");
      await sweep(t, await page.locator(".adv-btn").all(), 0.25);
    });
    await t.line("3.4", async () => {
      await t.cue("detail");
      await t.moveTo(page.locator(".right-panel"));
      await callout(t, page.locator(".right-panel"), "Changes and the commit box", 3);
    });
    await t.line("3.5", async () => {
      await t.click(row(page, "three-day outlook"));
      await t.cue("files");
      await t.moveTo(page.locator(".cd-files"));
    });
    await t.line("3.6", async () => {
      const tb = (name: string) => page.locator(".tb-btn", { hasText: name }).first();
      await t.cue("fetch");
      await sweep(t, [tb("Fetch"), tb("Pull"), tb("Push")], 0.15);
      await t.cue("stash");
      await sweep(t, [tb("Stash"), tb("Pop"), tb("Branch")], 0.15);
      await t.cue("pill");
      await t.moveTo(page.locator(".tb-branch"));
    });
    await t.line("3.7", async () => {
      await t.moveTo(page.locator(".console-dock .cdock-pane").first());
      await t.cue("activity");
      await t.moveTo(page.locator(".console-dock .cdock-pane").nth(1));
      await callout(t, page.locator(".console-dock .cdock-pane").nth(1), "Every git command, in plain sight", 3);
    });
    // The opening line plays over the graph, so it is recorded last.
    await t.line("1.2", async () => {
      await page.keyboard.press("Escape");
      await t.moveTo(page.locator(".graph-rows"));
      for (let i = 0; i < 6; i++) {
        await page.mouse.wheel(0, 90);
        await t.pause(0.35);
      }
    });
    await t.finish();
  },
};
