import { execFileSync } from "node:child_process";
import { launchGitGud } from "../app.ts";
import type { TakeFn } from "../record.ts";
import { callout, hideConsole, sidebarItem, sweep } from "./lib.ts";

const git = (repo: string, ...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" }).toString();

export const takes: Record<string, TakeFn> = {
  async conflicts(ctx) {
    const repo = ctx.demo();
    git(repo, "checkout", "--", ".");
    git(repo, "clean", "-fdq");
    const { app, page } = await launchGitGud({ userData: `${ctx.work}/ud`, tabs: [repo] });
    ctx.defer(() => app.close());
    await page.locator(".commit-row").first().waitFor();
    await hideConsole(page);
    const panel = page.locator(".conflict-panel");
    const editor = page.locator(".conflict-editor");
    const result = editor.locator("textarea.ce-textarea");
    const t = await ctx.take("conflicts", page);

    await t.line("1.1", async () => {
      await t.cue("merge");
      await t.rightClick(sidebarItem(page, "feature/metric-default"));
      await t.click(page.locator(".cm-menu button", { hasText: "into current branch" }).first());
      await panel.waitFor();
    });
    await t.line("1.2", async () => {
      await t.cue("paused");
      await callout(t, page.getByText("MERGE IN PROGRESS").first(), "Merge paused", 2.5);
      await t.cue("files");
      await t.moveTo(panel.locator(".conflict-file-row").first());
    });
    await t.line("1.3", async () => {
      await t.cue("Continue");
      await t.moveTo(panel.getByRole("button", { name: "Continue merge" }));
      await t.cue("Abort");
      await t.moveTo(panel.getByRole("button", { name: "Abort merge" }));
    });

    await t.line("2.1", async () => {
      await t.click(panel.locator(".conflict-file-row").first());
      await editor.waitFor();
      await t.cue("Current");
      await callout(t, editor.locator(".ce-pane-current .ce-pane-head"), "Your branch", 2.2);
      await t.cue("Incoming");
      await callout(t, editor.locator(".ce-pane-incoming .ce-pane-head"), "The branch you're merging", 2.2);
      await t.cue("result");
      await callout(t, editor.locator(".ce-pane-mid"), "The result", 2.2);
    });
    await t.line("2.2", async () => {
      await t.cue("differ");
      await t.moveTo(editor.locator(".ce-pane-current .ce-side-line-conflict").first());
      await t.cue("words");
      await t.moveTo(editor.locator(".ce-pane-incoming .ce-side-line-conflict").first());
    });
    await t.line("2.3", async () => {
      await sweep(t, [editor.locator(".ce-block-btn", { hasText: "Use this" }).first(), editor.locator(".ce-block-btn", { hasText: "Use both" }).first()], 0.5);
      await t.cue("arrows");
      await t.moveTo(editor.locator(".ce-blocknav"));
    });
    await t.line("2.4", async () => {
      // Put the cursor at the start of the conflicted line in the result, then click the incoming line.
      await t.click(result);
      await result.evaluate((el: HTMLTextAreaElement) => {
        const at = el.value.indexOf("export const DEFAULT_UNIT");
        el.setSelectionRange(at, at);
      });
      await t.cue("inserted");
      await t.click(editor.locator(".ce-pane-incoming .ce-side-line-conflict").first());
    });
    await t.line("2.5", async () => {
      await t.cue("mix");
      // Remove the inserted incoming line, then make the current one fall back to metres.
      await result.evaluate((el: HTMLTextAreaElement) => {
        const line = 'export const DEFAULT_UNIT = "m";\n';
        const at = el.value.indexOf(line);
        el.focus();
        el.setSelectionRange(at, at + line.length);
      });
      await page.keyboard.press("Backspace");
      await result.evaluate((el: HTMLTextAreaElement) => {
        const at = el.value.indexOf('?? "ft"') + 3;
        el.setSelectionRange(at, at + 4);
      });
      await t.cue("metres");
      await page.keyboard.type('"m"', { delay: 120 });
    });
    await t.line("2.6", async () => {
      await t.cue("gutter");
      await t.moveTo(editor.locator(".ce-rtag", { hasText: /\S/ }).first());
      await t.cue("legend");
      await callout(t, editor.locator(".ce-legend"), "Where each line came from", 3);
      await t.moveTo(editor.locator(".ce-legend"));
    });
    await t.line("2.7", async () => {
      await t.click(editor.getByRole("button", { name: "Save & Mark Resolved" }));
      await t.cue("warns");
      await t.moveTo(panel.getByRole("button", { name: "Continue merge" }));
    });
    await t.line("2.8", async () => {
      await t.click(panel.getByRole("button", { name: "Continue merge" }));
      await t.pause(1.5);
      await t.moveTo(page.locator(".commit-row").nth(1).locator(".cr-message"));
    });
    await t.finish();
  },

  async autofix(ctx) {
    const repo = ctx.demo();
    // A branch that rewrites the README line the working tree also edits, so checking it out is refused.
    git(repo, "stash", "push", "--include-untracked", "-q", "-m", "take setup");
    git(repo, "checkout", "-q", "-b", "docs/readme-refresh");
    execFileSync("sed", ["-i", "", "s/npm start -- --station 9414290/npx tidepool --station 9414290/", `${repo}/README.md`]);
    git(repo, "commit", "-qam", "docs: run it with npx");
    git(repo, "checkout", "-q", "main");
    git(repo, "stash", "pop", "-q");
    const { app, page } = await launchGitGud({ userData: `${ctx.work}/ud`, tabs: [repo] });
    ctx.defer(() => app.close());
    await page.locator(".commit-row").first().waitFor();
    await hideConsole(page);
    const toast = page.locator(".toast-container");
    const t = await ctx.take("autofix", page);

    await t.line("4.1", async () => {
      await t.moveTo(page.locator(".wt-file-row", { hasText: "README.md" }).first());
    });
    await t.line("4.2", async () => {
      await t.cue("README");
      await callout(t, page.locator(".wt-file-row", { hasText: "README.md" }).first(), "Local edits", 2.5);
      await t.cue("double");
      await t.dblclick(sidebarItem(page, "docs/readme-refresh"));
    });
    await t.line("4.3", async () => {
      await toast.locator(".toast-body").first().waitFor({ timeout: 15000 });
      await t.cue("step");
      await t.moveTo(toast.locator(".toast-body").first());
    });
    await t.line("4.4", async () => {
      await t.cue("pop");
      const pop = toast.locator(".toast-action").first();
      await callout(t, pop, "Bring the edits here", 2.5);
      await t.moveTo(pop);
    });
    await t.line("4.6", async () => {
      await t.click(page.getByTitle("Settings"));
      await t.cue("Auto-fix");
      const row = page.locator(".modal-panel").getByText("Auto-fix blocked actions");
      await callout(t, row, "Auto-fix blocked actions", 3);
      await t.moveTo(row);
    });
    await t.finish();
  },
};
