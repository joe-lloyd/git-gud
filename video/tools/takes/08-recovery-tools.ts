import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { launchGitGud } from "../app.ts";
import type { TakeFn } from "../record.ts";
import { callout, hideConsole, row, showConsole } from "./lib.ts";

const git = (repo: string, ...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" }).toString();
const clean = (repo: string) => {
  git(repo, "checkout", "--", ".");
  git(repo, "clean", "-fdq");
};

export const takes: Record<string, TakeFn> = {
  async recovery(ctx) {
    const repo = ctx.demo();
    clean(repo);
    const { app, page } = await launchGitGud({ userData: `${ctx.work}/ud`, tabs: [repo] });
    ctx.defer(() => app.close());
    await page.locator(".commit-row").first().waitFor();
    await hideConsole(page);
    const reflog = page.locator(".reflog-panel");
    const t = await ctx.take("recovery", page);

    await t.line("1.1", async () => {
      await t.rightClick(row(page, "changelog for 1.2.0").locator(".cr-message"));
      await t.click(page.locator(".cm-menu button", { hasText: "Reset → Hard" }));
      await t.click(page.locator(".modal-panel").getByRole("button", { name: "Reset Hard" }));
      await t.cue("label");
      await t.moveTo(page.locator(".ref-head").first());
    });
    await t.line("1.2", async () => {
      await t.cue("Open");
      await t.click(page.locator(".adv-btn", { hasText: "Reflog" }));
      await reflog.waitFor();
    });
    await t.line("1.3", async () => {
      const entry = (n: number) => reflog.locator(".reflog-entry, .reflog-row, li").nth(n);
      await t.moveTo(entry(0));
      await t.cue("commit");
      await t.moveTo(entry(1));
      await t.cue("Restore");
      await t.click(reflog.getByRole("button", { name: "Restore HEAD here" }).nth(1));
    });
    await t.line("1.4", async () => {
      await t.click(page.locator(".modal-panel").getByRole("button").last());
      await t.cue("back");
      await t.moveTo(row(page, "read the unit from TIDEPOOL_UNIT").locator(".cr-message"));
    });
    await t.finish();
  },

  async bisect(ctx) {
    const repo = ctx.demo();
    clean(repo);
    const { app, page } = await launchGitGud({ userData: `${ctx.work}/ud`, tabs: [repo] });
    ctx.defer(() => app.close());
    await page.locator(".commit-row").first().waitFor();
    const panel = page.locator(".bisect-panel");
    const consoleInput = page.getByPlaceholder("Run a command at the worktree root…");
    const testPasses = () => {
      try {
        execFileSync("node", ["test/units.test.js"], { cwd: repo, stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    };
    const runTests = async () => {
      // Clear first, so the output on screen is this run's.
      await page.locator(".console-dock .cdock-pane").first().locator(".cdock-btn", { hasText: "Clear" }).click();
      await t.type(consoleInput, "node test/units.test.js", 35);
      await page.keyboard.press("Enter");
      await t.pause(1.2);
    };
    const mark = async () => {
      const verdict = testPasses() ? "Good" : "Bad";
      await t.click(panel.getByRole("button", { name: new RegExp(`^${verdict}`) }));
      await t.pause(0.8);
    };
    const t = await ctx.take("bisect", page);

    await t.line("2.1", async () => {
      await runTests();
      await callout(t, page.locator(".console-dock .cdock-pane").first(), "AssertionError: 3 !== 3.05", 3);
    });
    await t.line("2.2", async () => {
      await t.click(page.locator(".adv-btn", { hasText: "Bisect" }));
      await t.cue("empty");
      await t.moveTo(panel.locator("select").first());
      await t.cue("good");
      const good = panel.locator("select").nth(1);
      const value = await good.locator("option", { hasText: "usage and units" }).getAttribute("value");
      await t.click(good);
      await good.selectOption(value!);
      await t.cue("Start");
      await t.click(panel.getByRole("button", { name: "Start Bisect" }));
    });
    await t.line("2.3", async () => {
      await t.cue("tests");
      await runTests();
      await t.cue("mark");
      await mark();
    });
    await t.line("2.4", async () => {
      await runTests();
      await t.cue("mark");
      await mark();
    });
    await t.line("2.5", async () => {
      while (!(await panel.getByText("Found the first bad commit").isVisible())) {
        await runTests();
        await mark();
      }
      await t.cue("helper");
      await t.moveTo(panel.locator(".bisect-output"));
    });
    await t.line("2.6", async () => {
      await t.click(panel.getByRole("button", { name: "Reset Bisect" }));
    });
    await t.finish();
  },

  async tools(ctx) {
    const repo = ctx.demo();
    // Build output for clean to find: ignored files next to the untracked one.
    mkdirSync(`${repo}/dist`, { recursive: true });
    writeFileSync(`${repo}/dist/tidepool.js`, "console.log('built')\n");
    mkdirSync(`${repo}/.cache`, { recursive: true });
    writeFileSync(`${repo}/.cache/noaa-9414290.json`, "{}\n");
    const { app, page } = await launchGitGud({ userData: `${ctx.work}/ud`, tabs: [repo] });
    ctx.defer(() => app.close());
    await page.locator(".commit-row").first().waitFor();
    await hideConsole(page);
    const patch = page.locator(".patch-panel");
    const cleanModal = page.locator(".clean-modal");
    const t = await ctx.take("tools", page);

    await t.line("3.1", async () => {
      await t.click(page.locator(".adv-btn", { hasText: "Patch" }));
      await t.cue("Export");
      await t.click(patch.getByRole("button", { name: /Generate Patch/ }));
      await t.cue("commit");
      await t.moveTo(patch.getByRole("button", { name: /Save patch/ }));
    });
    await t.line("3.2", async () => {
      await t.click(patch.getByRole("button", { name: "Apply", exact: true }).first());
      const area = patch.locator("textarea");
      await t.click(area);
      await area.fill(
        [
          "diff --git a/CHANGELOG.md b/CHANGELOG.md",
          "--- a/CHANGELOG.md",
          "+++ b/CHANGELOG.md",
          "@@ -1,3 +1,6 @@",
          " # Changelog",
          " ",
          "+## Unreleased",
          "+- Heights in metres",
          "+",
          " ## 1.2.0",
          "",
        ].join("\n"),
      );
      await t.cue("applies");
      await t.click(patch.getByRole("button", { name: "Apply Patch" }));
      await t.pause(0.8);
      await t.moveTo(page.locator(".wt-file-row, .commit-row.is-pseudo").first());
    });

    await t.line("4.1", async () => {
      await t.click(page.locator(".adv-btn", { hasText: "Clean" }));
      await cleanModal.waitFor();
      await t.cue("shows");
      const boxes = cleanModal.locator("input[type=checkbox]");
      await t.click(boxes.nth(2));
      await t.pause(0.8);
      await t.cue("untick");
      await t.click(boxes.last());
    });
    await t.line("4.2", async () => {
      await t.cue("delete");
      await t.type(cleanModal.getByPlaceholder("delete"), "delete", 120);
      await t.click(cleanModal.getByRole("button", { name: /^Clean/ }));
    });

    await t.line("5.1", async () => {
      await showConsole(t);
      const input = page.getByPlaceholder("Run a command at the worktree root…");
      await t.type(input, "git log --oneline -3", 45);
      await page.keyboard.press("Enter");
      await t.cue("Up");
      t.keys("↑");
      await page.keyboard.press("ArrowUp");
      await t.cue("Stop");
      await t.moveTo(page.locator(".console-dock .cdock-btn").first());
    });
    await t.line("5.2", async () => {
      await t.moveTo(page.locator(".console-dock .cdock-pane").nth(1));
      await t.cue("Changes");
      // Its label flips with the filter, so find it by position in the activity pane.
      const toggle = page.locator(".console-dock .cdock-pane").nth(1).locator(".cdock-btn").first();
      await t.click(toggle);
      await t.pause(1.2);
      await t.click(toggle);
    });
    await t.line("5.3", async () => {
      await t.click(page.locator(".console-dock").getByTitle("Copy visible log"));
      await t.cue("hidden");
    });
    await t.finish();
  },
};
