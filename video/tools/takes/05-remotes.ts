import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { fakeGitHub, launchGitGud } from "../app.ts";
import type { TakeFn } from "../record.ts";
import { callout, hideConsole, sweep } from "./lib.ts";

export const takes: Record<string, TakeFn> = {
  async remotes(ctx) {
    const repo = ctx.demo();
    // A clean tree, so pull and push stay about the remote.
    execFileSync("git", ["-C", repo, "checkout", "--", "."]);
    execFileSync("git", ["-C", repo, "clean", "-fdq"]);
    const { app, page } = await launchGitGud({ userData: `${ctx.work}/ud`, tabs: [repo] });
    ctx.defer(() => app.close());
    await page.locator(".commit-row").first().waitFor();
    await hideConsole(page);
    const tb = (name: string) => page.locator(".tb-btn", { hasText: name }).first();
    const menuItem = (label: string) => page.locator(".cm-menu button", { hasText: label }).first();
    const t = await ctx.take("remotes", page);

    await t.line("2.1", async () => {
      await t.click(tb("Fetch"));
      await t.cue("graph");
      const theirs = page.locator(".commit-row", { hasText: "add Boston" }).locator(".cr-message");
      await callout(t, theirs, "New on the remote", 3);
      await t.moveTo(theirs);
    });
    await t.line("2.2", async () => {
      await callout(t, page.locator(".tb-badge.behind"), "2 behind", 3);
      await t.moveTo(page.locator(".tb-badge.behind"));
    });
    await t.line("2.3", async () => {
      await t.click(page.locator(".tb-caret").first());
      await t.cue("normal");
      await sweep(t, [menuItem("Pull"), menuItem("fast-forward only"), menuItem("rebase")], 0.9);
      await page.keyboard.press("Escape");
    });
    await t.line("2.4", async () => {
      await t.click(tb("Pull"));
      await t.cue("fast-forwards");
      await t.moveTo(page.locator(".ref-head").first());
    });
    await t.line("2.5", async () => {
      await appendFile(`${repo}/CHANGELOG.md`, "\n## Unreleased\n- Boston is a favourite station\n");
      // As if saved from an editor: refresh so the change shows straight away.
      await page.keyboard.press("Meta+r");
      await t.click(page.locator(".wt-header-btn", { hasText: "Stage all" }));
      await t.type(page.getByPlaceholder("Subject"), "docs: note Boston in the changelog", 40);
      t.keys("Cmd+Enter");
      await page.keyboard.press("Meta+Enter");
      await t.cue("ahead");
      await callout(t, page.locator(".tb-badge.ahead").first(), "1 ahead", 2.5);
      await t.cue("Push");
      await t.click(tb("Push"));
    });
    await t.line("2.6", async () => {
      await t.rightClick(tb("Push"));
      await t.cue("force");
      await t.moveTo(menuItem("Force push"));
      await t.pause(1.5);
      await page.keyboard.press("Escape");
    });
    await t.finish();
  },

  async integrations(ctx) {
    const repo = ctx.demo();
    const { app, page } = await launchGitGud({ userData: `${ctx.work}/ud`, tabs: [repo] });
    ctx.defer(() => app.close());
    await fakeGitHub(app);
    await page.locator(".commit-row").first().waitFor();
    await hideConsole(page);
    const modal = page.locator(".gh-modal");
    const t = await ctx.take("integrations", page);

    await t.line("4.1", async () => {
      await t.click(page.getByTitle("GitHub"));
      await t.cue("Lab");
      await sweep(t, [modal.getByRole("button", { name: "GitHub", exact: true }), modal.getByRole("button", { name: "GitLab", exact: true }), modal.getByRole("button", { name: "Bitbucket", exact: true })], 0.3);
    });
    await t.line("4.2", async () => {
      await t.click(modal.getByRole("button", { name: "GitHub", exact: true }));
      await t.click(modal.getByRole("button", { name: /Log In with GitHub/ }));
      await t.cue("approve");
      await callout(t, modal.getByText("WDJB-MJHT"), "Enter this code on github.com", 3);
      await modal.getByText("alex-rivera").waitFor({ timeout: 20000 });
      await t.cue("Lab");
      await t.click(modal.getByRole("button", { name: "GitLab", exact: true }));
      await t.cue("self-hosted");
      await t.moveTo(modal.getByPlaceholder("https://gitlab.com"));
    });
    await t.line("4.3", async () => {
      await t.click(modal.getByRole("button", { name: "GitHub", exact: true }));
      await t.cue("encrypted");
      await t.moveTo(modal.getByText("alex-rivera"));
    });
    await t.line("4.4", async () => {
      await t.type(modal.getByPlaceholder("awesome-project"), "tidepool", 80);
      await t.cue("origin");
      await t.moveTo(modal.getByRole("button", { name: /Create/ }).first());
    });
    await t.line("4.5", async () => {
      await page.keyboard.press("Escape");
      await t.click(page.locator(".tab-home"));
      await t.click(page.getByRole("button", { name: /Clone from Remote/ }));
      await t.cue("URL");
      await t.moveTo(page.getByPlaceholder("https://github.com/owner/repo.git"));
      await t.cue("browse");
      await t.click(page.locator(".clone-modal").getByRole("button", { name: "GitHub", exact: true }));
      await t.type(page.locator(".clone-modal").getByPlaceholder(/Search/), "surf", 120);
    });
    await t.finish();
  },
};
