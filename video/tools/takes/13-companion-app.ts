import { appendFileSync } from "node:fs";
import { launchGitGud } from "../app.ts";
import { launchPhone, serveCompanion } from "../phone.ts";
import type { TakeFn } from "../record.ts";
import { callout } from "./lib.ts";

type PeerApi = {
  setServer: (p: object) => Promise<{ server: { fingerprint: string; paired: { peerId: string; name: string; kind: string }[] } }>;
  pairingQr: () => Promise<{ payload: string }>;
  getState: () => Promise<{ server: { paired: { peerId: string; kind: string }[] } }>;
  setDeviceScopes: (peerId: string, scopes: string[]) => Promise<boolean>;
};

export const takes: Record<string, TakeFn> = {
  async phone(ctx) {
    const repo = ctx.demo("buildbox");
    const host = await launchGitGud({ userData: `${ctx.work}/host`, tabs: [repo] });
    ctx.defer(() => host.app.close());
    await host.page.locator(".commit-row").first().waitFor();
    const peerApi = <T>(fn: (api: PeerApi, arg: unknown) => Promise<T>, arg?: unknown) =>
      host.page.evaluate(([source, a]) => new Function("api", "arg", `return (${source})(api, arg)`)((window as unknown as { peerApi: PeerApi }).peerApi, a), [fn.toString(), arg] as const) as Promise<T>;
    // Not 47831: a real gitgud-headless may already be serving on this machine.
    const state = await peerApi((api) => api.setServer({ name: "build-box", enabled: true, port: 47861 }));
    const { payload } = await peerApi((api) => api.pairingQr());
    const web = await serveCompanion(process.env.COMPANION_WEB ?? "/tmp/gg-companion-web");
    ctx.defer(web.close);
    const { shell, stage, phone } = await launchPhone({ appUrl: web.url, hostFingerprint: state.server.fingerprint, userData: `${ctx.work}/stage` });
    ctx.defer(() => shell.close());
    await phone.getByText("Pair a machine (scan QR)").filter({ visible: true }).waitFor({ timeout: 30000 });
    const say = (heading: string, text: string) => stage.evaluate(([h, x]) => (window as unknown as { stage: { say: (a: string, b: string) => void } }).stage.say(h!, x!), [heading, text] as const);
    // Screens further down the stack keep their (hidden) headers, so take the visible back button.
    const back = () => phone.locator('[aria-label$="back" i]').filter({ visible: true }).first();
    const t = await ctx.take("phone", stage, { touch: true });

    await t.line("1.1", async () => {
      await t.moveTo(phone.getByText("Pair a machine (scan QR)").filter({ visible: true }));
    });
    await t.line("1.2", async () => {
      await say("Pairing", "Scan the QR from the host, or paste its pairing link.");
      await t.click(phone.getByText("Pair a machine (scan QR)").filter({ visible: true }));
      await t.cue("paste");
      const field = phone.getByPlaceholder(/gitgud-peer/);
      await t.click(field);
      await stage.keyboard.insertText(payload);
      await t.click(phone.getByText("Pair", { exact: true }).last());
    });
    await t.line("1.3", async () => {
      await phone.getByText("tidepool").filter({ visible: true }).first().waitFor({ timeout: 20000 });
      await t.cue("pins");
      await t.moveTo(phone.getByText(/pinned/).first());
    });

    await t.line("2.1", async () => {
      await say("Machines", "Every paired computer, and whether it's reachable now.");
      await t.click(back());
      await t.cue("Tap");
      await t.click(phone.getByText("build-box").filter({ visible: true }).first());
    });
    await t.line("2.2", async () => {
      await say("Repositories", "The same lane-colored graph, sized for a phone.");
      await t.click(phone.getByText("tidepool").filter({ visible: true }).first());
      await t.cue("graph");
    });
    await t.line("2.3", async () => {
      await t.click(phone.getByText(/read the unit from TIDEPOOL_UNIT/).first());
      await t.pause(1.2);
      await t.click(back());
      await t.cue("working");
      await t.click(phone.getByText(/^Working tree/).first());
      await t.cue("diff");
      await t.click(phone.getByText(/forecast\.ts/).first());
      await t.pause(1.5);
      await t.click(back());
    });
    await t.line("2.4", async () => {
      await t.click(phone.getByText("Activity", { exact: true }).first());
    });
    await t.line("2.5", async () => {
      await say("Live", "Change the repository on the computer, and the phone follows.");
      await t.click(phone.getByText(/^Working tree/).first());
      await t.cue("changes");
      appendFileSync(`${repo}/CHANGELOG.md`, "\n## Unreleased\n- Heights in metres\n");
      const row = phone.getByText("CHANGELOG.md").first();
      await row.waitFor({ timeout: 15000 });
      await t.moveTo(row);
    });

    await t.line("3.2", async () => {
      await say("Scopes", "The host can allow fetch, pull or push, one at a time.");
      // On the host: allow this phone to fetch.
      const paired = (await peerApi((api) => api.getState())).server.paired;
      const device = paired.find((p) => p.kind === "companion") ?? paired[0];
      if (!device) throw new Error("The phone is not paired");
      await peerApi((api, id) => api.setDeviceScopes(id as string, ["fetch"]), device.peerId);
      await t.cue("Fetch");
      // Back out to Machines and in again, so the phone re-checks what it may do.
      await t.click(back());
      await t.click(back());
      await t.click(phone.getByText("build-box").filter({ visible: true }).first());
      await t.click(phone.getByText("tidepool").filter({ visible: true }).first());
      const fetch = phone.getByText("Fetch", { exact: true }).first();
      await fetch.waitFor({ timeout: 15000 });
      await t.moveTo(fetch);
    });
    await t.finish();
  },
};
