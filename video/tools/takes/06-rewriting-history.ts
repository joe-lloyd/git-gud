import { execFileSync } from "node:child_process";
import { launchGitGud } from "../app.ts";
import type { TakeFn } from "../record.ts";
import { callout, hideConsole, row, showConsole, sweep } from "./lib.ts";

export const takes: Record<string, TakeFn> = {
  async history(ctx) {
    const repo = ctx.demo();
    // A clean tree, so every rewrite here runs without the auto-fix stepping in.
    execFileSync("git", ["-C", repo, "checkout", "--", "."]);
    execFileSync("git", ["-C", repo, "clean", "-fdq"]);
    const { app, page } = await launchGitGud({ userData: `${ctx.work}/ud`, tabs: [repo] });
    ctx.defer(() => app.close());
    await page.locator(".commit-row").first().waitFor();
    await hideConsole(page);
    const menuItem = (label: string) => page.locator(".cm-menu button", { hasText: label }).first();
    const message = (text: string) => row(page, text).locator(".cr-message");
    const ir = page.locator(".ir-panel");
    const irRow = (text: string) => ir.locator(".ir-row", { hasText: text }).first();
    const t = await ctx.take("history", page);

    await t.line("1.1", async () => {
      await t.rightClick(message("mark the current time"));
    });
    await t.line("1.2", async () => {
      await t.cue("check");
      await sweep(t, [menuItem("Checkout (detached HEAD)"), menuItem("Create branch here"), menuItem("Create tag here")], 0.3);
      await t.cue("cherry-pick");
      await sweep(t, [menuItem("Cherry-pick"), menuItem("Revert commit")], 0.4);
    });
    await t.line("1.3", async () => {
      await t.cue("Soft");
      await t.moveTo(menuItem("Reset → Soft"));
      await t.cue("mixed");
      await t.moveTo(menuItem("Reset → Mixed"));
      await t.cue("hard");
      await t.moveTo(menuItem("Reset → Hard"));
    });
    await t.line("1.4", async () => {
      await sweep(t, [menuItem("Rebase onto this commit"), menuItem("Merge this into current branch"), menuItem("Export patch"), menuItem("Edit author")], 0.5);
      await page.keyboard.press("Escape");
    });

    await t.line("2.1", async () => {
      await t.rightClick(message("spike: rain radar tiles"));
      await t.click(menuItem("Cherry-pick"));
      await t.cue("copied");
      const copy = page.locator(".commit-row").nth(1).locator(".cr-message");
      await callout(t, copy, "The copy, on main", 3);
      await t.moveTo(copy);
    });
    await t.line("2.2", async () => {
      await t.rightClick(message("list of favourite stations"));
      await t.click(menuItem("Revert commit"));
      await t.cue("honest");
      await t.moveTo(page.locator(".commit-row").nth(1).locator(".cr-message"));
    });

    await t.line("3.1", async () => {
      await t.rightClick(message("mark the current time"));
      await t.click(menuItem("Interactive rebase from here"));
      await ir.waitFor();
    });
    await t.line("3.2", async () => {
      await t.cue("Drag");
      const from = await irRow("spike: rain radar").locator(".ir-drag-handle").boundingBox();
      const to = await irRow("read the unit").locator(".ir-drag-handle").boundingBox();
      if (!from || !to) throw new Error("rebase rows not visible");
      await t.drag({ x: from.x + 6, y: from.y + from.height / 2 }, { x: to.x + 6, y: to.y + to.height / 2 }, 1000);
      await t.cue("cycle");
      // pick → reword → squash: fold the release commit into the changelog.
      const release = irRow("chore(release)").locator(".ir-action");
      await t.click(release);
      await t.click(release);
      await t.cue("drop");
      const revert = irRow("Revert").locator(".ir-action");
      for (let i = 0; i < 4; i++) await t.click(revert, { ms: 250 });
    });
    await t.line("3.3", async () => {
      await t.dblclick(irRow("spike: rain radar").locator(".ir-msg"));
      const input = ir.locator(".ir-msg-input");
      await input.fill("");
      await t.type(input, "feat(radar): rain radar tiles, behind a flag", 45);
      await page.keyboard.press("Enter");
    });
    await t.line("3.4", async () => {
      await t.click(ir.getByRole("button", { name: "Start Rebase" }));
      await t.cue("redraws");
      await t.moveTo(page.locator(".commit-row").nth(2).locator(".cr-message"));
    });

    await t.line("4.1", async () => {
      await t.cue("shift-click");
      await t.click(message("cache station responses"));
      await t.click(message("share one rounding helper"), { modifiers: ["Shift"] });
    });
    await t.line("4.2", async () => {
      await t.cue("squash");
      await sweep(t, ["Squash", "Cherry-pick", "Revert", "Drop"].map((name) => page.locator(".right-panel").getByRole("button", { name, exact: true })), 0.4);
    });
    await t.line("4.3", async () => {
      await t.click(page.locator(".right-panel").getByRole("button", { name: "Squash", exact: true }));
      // Some versions ask for the combined message first.
      const confirm = page.locator(".modal-panel, .ir-panel").getByRole("button", { name: /Squash|OK|Confirm/ }).last();
      if (await confirm.isVisible().catch(() => false)) await t.click(confirm);
      await t.cue("one");
    });
    await t.line("4.4", async () => {
      await showConsole(t);
      await t.cue("log", 2);
      await t.moveTo(page.locator(".adv-btn", { hasText: "Reflog" }));
    });
    await t.finish();
  },
};
