import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { launchGitGud } from "../app.ts";
import type { TakeFn } from "../record.ts";
import { callout, hideConsole, onlyBuildBox } from "./lib.ts";

export const takes: Record<string, TakeFn> = {
  // Both windows record at once; each narrated line plays over the window it talks about.
  async peers(ctx) {
    const repo = ctx.demo("buildbox");
    const host = await launchGitGud({ userData: `${ctx.work}/host`, tabs: [repo] });
    ctx.defer(() => host.app.close());
    const client = await launchGitGud({ userData: `${ctx.work}/client`, recent: [] });
    ctx.defer(() => client.app.close());
    await host.page.locator(".commit-row").first().waitFor();
    await hideConsole(host.page);
    await host.page.evaluate(() => (window as unknown as { peerApi: { setServer: (p: object) => Promise<unknown> } }).peerApi.setServer({ name: "build-box", enabled: false, port: 47841 }) /* a real gitgud-headless may hold 47831 here */);
    // The host lists the client by name; call it "laptop", not this Mac's real hostname.
    await client.page.evaluate(() => (window as unknown as { peerApi: { setServer: (p: object) => Promise<unknown> } }).peerApi.setServer({ name: "laptop", enabled: false }));
    await onlyBuildBox(client.page);
    const settings = host.page.locator(".modal-panel", { hasText: "Text size" });
    const shareRow = settings.getByText("Share with other Git Gud instances", { exact: true }).first();
    const peerModal = client.page.locator(".peer-modal");

    const h = await ctx.take("host", host.page);
    const c = await ctx.take("client", client.page);

    await h.line("2.1", async () => {
      await h.moveTo(host.page.locator(".tab.active"));
      await h.cue("open");
      await h.moveTo(host.page.locator(".graph-rows"));
    });
    await h.line("2.2", async () => {
      await h.click(host.page.getByTitle("Settings"));
      await shareRow.scrollIntoViewIfNeeded();
      await h.cue("switch");
      await h.click(shareRow.locator("xpath=../..").locator("label").first());
    });
    let code = "";
    await h.line("2.3", async () => {
      const codeCard = settings.getByText("Pairing code").first();
      await codeCard.scrollIntoViewIfNeeded();
      await h.cue("name");
      await h.moveTo(settings.locator("input").filter({ hasText: "" }).nth(0));
      await h.cue("port");
      await h.cue("six-digit");
      await callout(h, codeCard, "The pairing code", 3);
      await h.moveTo(codeCard);
      await h.cue("Generate");
      await h.click(settings.getByTitle("Generate a new code"));
      code = (await settings.locator(".peer-code").first().innerText()).replace(/\D/g, "");
    });

    await c.line("3.1", async () => {
      await c.click(client.page.getByRole("button", { name: /Connect to a Peer/ }));
      await c.cue("Nearby");
      await peerModal.getByText("build-box").first().waitFor({ timeout: 20000 });
      await callout(c, peerModal.getByText("build-box").first(), "Found on the network", 3);
    });
    await c.line("3.2", async () => {
      await c.click(peerModal.getByText("build-box").first());
      await c.cue("type");
      await c.type(peerModal.getByPlaceholder("000000"), code, 140);
      await c.click(peerModal.getByRole("button", { name: "Pair", exact: true }));
    });
    await c.line("3.3", async () => {
      await peerModal.locator(".peer-repo").first().waitFor({ timeout: 20000 });
      await c.cue("lists");
      await c.moveTo(peerModal.locator(".peer-repo").first());
    });
    await c.line("3.4", async () => {
      await c.click(peerModal.locator(".peer-repo").first());
      await client.page.locator(".commit-row").first().waitFor({ timeout: 30000 });
      await hideConsole(client.page);
      await c.cue("tab");
      await callout(c, client.page.locator(".tab.active"), "tidepool on build-box", 3);
      await c.moveTo(client.page.locator(".tab.active"));
    });

    await c.line("4.1", async () => {
      await c.cue("edit");
      appendFileSync(`${repo}/CHANGELOG.md`, "\n## Unreleased\n- Edited on the build box\n");
      await c.cue("here");
      const row = client.page.locator(".wt-file-row", { hasText: "CHANGELOG.md" }).first();
      await row.waitFor({ timeout: 15000 });
      await callout(c, row, "Changed on the build box", 3);
      await c.moveTo(row);
    });
    await h.line("4.2", async () => {
      await host.page.keyboard.press("Escape");
      await settings.getByRole("button", { name: "Done" }).click().catch(() => {});
      // Committed from the laptop: stage everything and commit through the client window.
      await client.page.locator(".wt-header-btn", { hasText: "Stage all" }).click();
      await client.page.getByPlaceholder("Subject").fill("docs: note the build box edit");
      await client.page.locator(".wt-commit-btn").click();
      await h.cue("window");
      const committed = host.page.locator(".commit-row", { hasText: "note the build box edit" }).first();
      await committed.waitFor({ timeout: 15000 });
      await callout(h, committed.locator(".cr-message"), "Committed from the laptop", 3);
      await h.moveTo(committed.locator(".cr-message"));
    });
    await h.line("4.3", async () => {
      await h.click(host.page.getByTitle("Settings"));
      const device = settings.getByText(/Read-only/).last();
      await device.scrollIntoViewIfNeeded();
      await h.cue("read-only");
      await h.moveTo(device);
      await h.cue("Revoke");
      await h.moveTo(settings.getByRole("button", { name: /Revoke/ }).first());
    });
    await h.line("4.4", async () => {
      const global = settings.getByText("Read-only", { exact: true }).first();
      await global.scrollIntoViewIfNeeded();
      await callout(h, global, "Every device, read-only", 3);
      await h.moveTo(global);
    });
    await c.finish();
    await h.finish();
  },
};
