import { launchGitGud } from "../app.ts";
import type { TakeFn } from "../record.ts";
import { callout, hideConsole, showConsole } from "./lib.ts";

export const takes: Record<string, TakeFn> = {
  async staging(ctx) {
    const repo = ctx.demo();
    const { app, page } = await launchGitGud({ userData: `${ctx.work}/ud`, tabs: [repo] });
    ctx.defer(() => app.close());
    await page.locator(".commit-row").first().waitFor();
    await hideConsole(page);
    const changes = page.locator(".wt-section").first();
    const fileRow = (name: string, section = changes) => section.locator(".wt-file-row", { hasText: name }).first();
    const diffButton = (label: string) => page.locator(".diff-toggle", { hasText: label });
    const t = await ctx.take("staging", page);

    await t.line("2.1", async () => {
      await t.cue("pencil");
      await callout(t, fileRow("README.md").locator(".wt-status-svg"), "Modified", 2.5);
      await t.moveTo(fileRow("README.md"));
      await t.cue("plus");
      await callout(t, fileRow("legend.ts").locator(".wt-status-svg"), "New file", 2.5);
      await t.moveTo(fileRow("legend.ts"));
    });
    await t.line("2.2", async () => {
      await t.moveTo(fileRow("forecast.ts"));
      await t.cue("discard");
      await t.moveTo(fileRow("forecast.ts").locator(".wt-file-discard"));
      await t.cue("Stage");
      await t.moveTo(changes.locator(".wt-header-btn", { hasText: "Stage all" }));
    });
    await t.line("2.3", async () => {
      await t.click(fileRow("README.md"));
      await t.cue("walk");
      for (const _ of [1, 2]) {
        t.keys("↓");
        await page.keyboard.press("ArrowDown");
        await t.pause(0.7);
      }
      await t.cue("arrow");
      await t.click(fileRow("legend.ts").locator('.wt-file-action[title="Stage"]'));
    });
    await t.line("3.1", async () => {
      await t.click(fileRow("forecast.ts"));
      await t.cue("hunks");
      await callout(t, page.locator(".diff-line-hunk").first(), "A hunk", 2.5);
    });
    await t.line("3.2", async () => {
      await t.click(diffButton("Word diff"));
      await t.cue("words");
      await t.moveTo(page.locator(".diff-line-add").nth(1));
    });
    await t.line("3.3", async () => {
      await t.click(diffButton("Word diff"));
      await t.click(page.getByTitle("Toggle side-by-side view"));
      await t.cue("right");
      await t.moveTo({ x: 950, y: 400 });
      await t.pause(1.2);
      await t.click(page.getByTitle("Toggle side-by-side view"));
    });
    await t.line("3.4", async () => {
      await t.cue("conversion");
      await t.moveTo(page.locator(".diff-line-add").nth(2));
      await t.cue("debug");
      const log = page.locator(".diff-line-add", { hasText: "outlook loaded" });
      await log.scrollIntoViewIfNeeded();
      await callout(t, log, "Doesn't belong in the commit", 3);
      await t.moveTo(log);
    });
    await t.line("3.5", async () => {
      await page.locator(".diff-body").evaluate((el) => el.scrollTo({ top: 0, behavior: "smooth" }));
      // The hunk keys work once focus is inside the diff.
      await t.click(page.locator(".diff-line-context .diff-content").nth(2));
      await t.moveTo(page.locator(".diff-line-hunk").first().locator(".diff-chunk-btn").first());
      await t.cue("S", 1);
      t.keys("S");
      await page.keyboard.press("s");
      await t.cue("both");
      await t.moveTo(page.locator(".wt-section").nth(1).locator(".wt-file-row", { hasText: "forecast.ts" }));
    });
    await t.line("3.6", async () => {
      await t.click(fileRow("README.md"));
      await t.cue("plus");
      const usage = page.locator(".diff-line-add", { hasText: "npm start" }).locator(".diff-sign");
      await callout(t, usage, "Stage just this line", 2.5);
      await t.click(usage);
    });
    await t.line("3.7", async () => {
      await t.click(fileRow("forecast.ts"));
      const discard = page.locator(".diff-line-hunk").last().locator(".diff-chunk-btn-danger");
      await t.cue("Discard");
      await t.click(discard);
      // The second click has to land within three seconds.
      await t.pause(1.2);
      await t.click(discard);
    });
    await t.line("3.8", async () => {
      await t.click(fileRow("README.md"));
      await t.click(page.locator(".diff-line-context .diff-content").nth(1));
      await t.cue("question");
      t.keys("?");
      await page.keyboard.press("?");
      await t.pause(2.5);
      await page.keyboard.press("?");
      await page.keyboard.press("Escape");
    });

    await t.line("4.1", async () => {
      await t.type(page.getByPlaceholder("Subject"), "feat(forecast): heights in metres", 55);
      await t.cue("counter");
      await callout(t, page.locator(".wt-subject-count, .wt-commit-box").first(), "50 characters reads best", 2.5);
    });
    await t.line("4.2", async () => {
      await t.type(page.getByPlaceholder("Description (optional)"), "Pass unit: \"m\" to get metres. Adds a legend.", 30);
      await t.cue("Amend");
      await t.moveTo(page.getByText("Amend last commit"));
    });
    await t.line("4.3", async () => {
      await t.cue("Skip");
      await t.moveTo(page.getByText("Skip hooks"));
      await t.cue("Sign-off");
      await t.moveTo(page.getByText("Sign-off", { exact: true }));
    });
    await t.line("4.4", async () => {
      await page.getByPlaceholder("Description (optional)").focus();
      await t.cue("Command");
      t.keys("Cmd+Enter");
      await page.keyboard.press("Meta+Enter");
      await t.cue("graph");
      await t.moveTo(page.locator(".commit-row").nth(1).locator(".cr-message"));
      await t.cue("README");
      await t.moveTo(fileRow("README.md"));
    });
    await t.line("4.5", async () => {
      await showConsole(t);
      await t.cue("commit");
      const entry = page.locator(".cdock-log").last();
      await callout(t, entry, "git commit", 3);
      await t.moveTo(entry);
    });
    await t.finish();
  },
};
