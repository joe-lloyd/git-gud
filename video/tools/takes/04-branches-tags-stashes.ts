import { launchGitGud } from "../app.ts";
import type { TakeFn } from "../record.ts";
import { callout, hideConsole, row, sidebarItem, sweep } from "./lib.ts";

export const takes: Record<string, TakeFn> = {
  async branches(ctx) {
    const repo = ctx.demo();
    const { app, page } = await launchGitGud({ userData: `${ctx.work}/ud`, tabs: [repo] });
    ctx.defer(() => app.close());
    await page.locator(".commit-row").first().waitFor();
    await hideConsole(page);
    const menu = page.locator(".cm-menu");
    const menuItem = (label: string) => menu.locator("button, .cm-item, [role=menuitem]", { hasText: label }).first();
    const section = (label: string) => page.locator(".sb-section", { has: page.locator(".sb-section-label", { hasText: label }) });
    const pill = (name: string) => page.locator(".ref-pill", { hasText: name }).first();
    const t = await ctx.take("branches", page);

    await t.line("1.1", async () => {
      await t.moveTo(sidebarItem(page, "experiment/radar"));
      await t.cue("tick");
      await callout(t, sidebarItem(page, "main"), "Checked out", 2.5);
      await t.moveTo(sidebarItem(page, "main"));
    });
    await t.line("1.2", async () => {
      await t.dblclick(sidebarItem(page, "experiment/radar"));
      await t.cue("pill");
      await t.moveTo(page.locator(".tb-branch"));
      await t.cue("head");
      await t.moveTo(page.locator(".ref-head").first());
    });
    await t.line("1.3", async () => {
      await t.click(page.locator(".tb-btn", { hasText: "Branch" }));
      await t.cue("Type");
      await t.type(page.getByPlaceholder("Branch name"), "feature/station-picker", 60);
      await t.cue("Create");
      await t.click(page.getByRole("button", { name: "Create", exact: true }));
    });
    await t.line("1.4", async () => {
      await t.rightClick(sidebarItem(page, "feature/dark-mode"));
      await t.cue("rename");
      await sweep(t, [menuItem("Rename"), menuItem("Merge"), menuItem("Rebase current branch"), menuItem("Push to remote"), menuItem("Delete")], 0.35);
      await page.keyboard.press("Escape");
    });
    await t.line("1.5", async () => {
      await t.rightClick(row(page, "list of favourite stations").locator(".cr-message"));
      await t.cue("Create");
      await t.moveTo(menuItem("Create branch here"));
      await t.pause(1);
      await page.keyboard.press("Escape");
    });

    await t.line("2.1", async () => {
      await t.dblclick(sidebarItem(page, "main"));
      await t.cue("Drag");
      const from = await pill("feature/hourly-forecast").boundingBox();
      const to = await pill("main").boundingBox();
      if (!from || !to) throw new Error("pills not visible");
      await t.drag({ x: from.x + 40, y: from.y + from.height / 2 }, { x: to.x + 30, y: to.y + to.height / 2 }, 1400);
    });
    await t.line("2.2", async () => {
      await t.cue("merge");
      await t.moveTo(menuItem("Merge"));
      await t.cue("rebase");
      await t.moveTo(menuItem("Rebase"));
      await t.cue("check");
      await t.moveTo(menuItem("Checkout"));
    });
    await t.line("2.3", async () => {
      await t.click(menuItem("Merge"));
      await t.cue("joining");
      await t.moveTo(row(page, "Merge branch 'feature/hourly-forecast'").locator(".cr-message"));
    });

    await t.line("3.1", async () => {
      await t.rightClick(row(page, "say which station failed").locator(".cr-message"));
      await t.click(menuItem("Create tag here"));
      await t.type(page.getByPlaceholder("Tag name (e.g. v1.2.3)"), "v1.2.1", 90);
      await t.click(page.getByRole("button", { name: "Create Tag" }));
      await t.cue("annotated");
      await t.moveTo(pill("v1.2.1"));
    });
    await t.line("3.2", async () => {
      const tag = section("TAGS").locator(".sb-item", { hasText: "v1.2.1" }).first();
      await t.rightClick(tag);
      await t.cue("push");
      await sweep(t, [menuItem("Push tag"), menuItem("Rename"), menuItem("Delete local tag"), menuItem("Create branch from")], 0.4);
      await page.keyboard.press("Escape");
    });

    await t.line("4.1", async () => {
      await t.click(page.locator(".tb-btn", { hasText: "Stash" }).first());
      await t.cue("message");
      const input = page.locator(".modal-panel input").first();
      await input.fill("");
      await t.type(input, "wip: metres in the forecast", 50);
      await t.click(page.locator(".modal-panel").getByRole("button", { name: "Stash", exact: true }));
    });
    await t.line("4.2", async () => {
      await t.cue("diamond");
      await t.moveTo(page.locator(".commit-row.is-stash .cr-message").first());
      await t.cue("stash", 2);
      await t.moveTo(section("STASHES").locator(".sb-item").first());
    });
    await t.line("4.3", async () => {
      await t.click(page.locator(".tb-btn", { hasText: "Pop" }));
      await t.cue("stash", 2);
      await t.rightClick(section("STASHES").locator(".sb-item").first());
      await sweep(t, [menuItem("Apply"), menuItem("Drop"), menuItem("Create branch from stash")], 0.4);
      await page.keyboard.press("Escape");
    });

    await t.line("5.1", async () => {
      await t.cue("hotfix");
      await callout(t, section("WORKTREES"), "Worktrees", 3);
      await t.moveTo(section("WORKTREES").locator(".sb-item").nth(1));
    });
    await t.line("5.2", async () => {
      await t.click(section("WORKTREES").getByTitle("Manage worktrees…"));
      await t.cue("branch");
      await t.type(page.getByPlaceholder("Branch", { exact: true }), "hotfix/station-timeout", 60);
      await t.cue("suggests");
      await t.moveTo(page.locator(".wtp-add-row input").nth(1));
      await t.pause(0.6);
      await t.click(page.getByRole("button", { name: "Add", exact: true }));
      await t.pause(1.5);
      await t.click(page.locator(".ir-close").last());
    });
    await t.line("5.3", async () => {
      await t.rightClick(section("WORKTREES").locator(".sb-item", { hasText: "hotfix/tide-offset" }).first());
      await t.click(menuItem("Switch to"));
      await page.locator(".tb-worktree-chip").waitFor({ timeout: 30000 });
      await page.locator(".commit-row").first().waitFor({ timeout: 30000 });
      await t.cue("badge");
      await callout(t, page.locator(".tb-worktree-chip"), "Which checkout you're in", 3);
      await t.moveTo(page.locator(".tb-worktree-chip"));
    });
    await t.finish();
  },
};
