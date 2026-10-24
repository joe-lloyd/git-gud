import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { launchGitGud } from "../app.ts";
import type { TakeFn } from "../record.ts";
import { callout, hideConsole } from "./lib.ts";

const HOST = "review.tidepool.dev";

type Patchset = { sha: string; number: number; created: string; kind: string };
type Change = { number: number; changeId: string; subject: string; owner: string; wip: boolean; updated: string; patchsets: Patchset[] };

/**
 * Turns the demo repo into a Gerrit project: a .gitreview, a Change-Id hook, three open changes on
 * the remote under refs/changes/ (one with two patch sets, one built on the older of them, one WIP),
 * and one local commit waiting to be pushed for review.
 */
function gerritify(repo: string): Change[] {
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" }).toString().trim();
  git("checkout", "--", ".");
  git("clean", "-fdq");
  // Catch up with the teammate's commits on the remote first.
  git("pull", "-q", "--rebase", "origin", "main");
  writeFileSync(`${repo}/.gitreview`, `[gerrit]\nhost=${HOST}\nport=29418\nproject=tidepool\ndefaultbranch=main\n`);
  git("add", ".gitreview");
  git("commit", "-qm", "chore: point git-review at review.tidepool.dev");
  git("push", "-q", "origin", "main");
  const hook = `${repo}/.git/hooks/commit-msg`;
  writeFileSync(hook, `#!/bin/sh\n# Adds a Gerrit Change-Id to every commit message.\ngrep -q '^Change-Id:' "$1" || printf '\\nChange-Id: I%s\\n' "$(git hash-object --stdin < "$1")" >> "$1"\n`);
  chmodSync(hook, 0o755);
  const base = git("rev-parse", "HEAD");
  const commitAs = (who: string, message: string, file: string, content: string) => {
    mkdirSync(dirname(`${repo}/${file}`), { recursive: true });
    writeFileSync(`${repo}/${file}`, content);
    git("add", file);
    execFileSync("git", ["-C", repo, "commit", "-qm", message], { env: { ...process.env, GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: `${who.split(" ")[0]!.toLowerCase()}@tidepool.dev` } });
    return git("rev-parse", "HEAD");
  };
  const changeId = () => /Change-Id: (I\w+)/.exec(git("log", "-1", "--format=%B"))![1]!;
  const push = (sha: string, ref: string) => git("push", "-q", "origin", `${sha}:${ref}`);

  git("checkout", "-q", "--detach", base);
  const a1 = commitAs("Priya Raman", "feat(stations): search stations by name", "src/search.ts", "export const search = (q: string) => q.toLowerCase();\n");
  const id101 = changeId();
  push(a1, "refs/changes/01/101/1");
  const b1 = commitAs("Sam Okafor", "feat(chart): label the axes", "src/ui/axes.ts", "export const axes = ['time', 'height'];\n");
  const id102 = changeId();
  push(b1, "refs/changes/02/102/1");
  git("checkout", "-q", "--detach", a1);
  writeFileSync(`${repo}/src/search.ts`, "export const search = (q: string) => q.trim().toLowerCase();\n");
  git("add", "src/search.ts");
  execFileSync("git", ["-C", repo, "commit", "-q", "--amend", "--no-edit"], { env: { ...process.env, GIT_AUTHOR_NAME: "Priya Raman", GIT_AUTHOR_EMAIL: "priya@tidepool.dev" } });
  const a2 = git("rev-parse", "HEAD");
  push(a2, "refs/changes/01/101/2");
  git("checkout", "-q", "--detach", base);
  const c1 = commitAs("Maya Chen", "wip: tide alarms", "src/alarms.ts", "// TODO\n");
  const id103 = changeId();
  push(c1, "refs/changes/03/103/1");
  git("checkout", "-q", "main");
  commitAs("Alex Rivera", "docs: describe the station search", "docs/search.md", "# Station search\n\nType part of a name.\n");

  return [
    { number: 101, changeId: id101, subject: "feat(stations): search stations by name", owner: "Priya Raman", wip: false, updated: "2026-10-23 16:40:00.000000000",
      patchsets: [{ sha: a1, number: 1, created: "2026-10-22 10:05:00.000000000", kind: "REWORK" }, { sha: a2, number: 2, created: "2026-10-23 16:40:00.000000000", kind: "REWORK" }] },
    { number: 102, changeId: id102, subject: "feat(chart): label the axes", owner: "Sam Okafor", wip: false, updated: "2026-10-22 11:30:00.000000000",
      patchsets: [{ sha: b1, number: 1, created: "2026-10-22 11:30:00.000000000", kind: "REWORK" }] },
    { number: 103, changeId: id103, subject: "wip: tide alarms", owner: "Maya Chen", wip: true, updated: "2026-10-24 08:15:00.000000000",
      patchsets: [{ sha: c1, number: 1, created: "2026-10-24 08:15:00.000000000", kind: "REWORK" }] },
  ];
}

/** Just enough of Gerrit's REST API for the open-changes query. */
function gerritServer(changes: Change[]) {
  const body = changes.map((c) => {
    const current = c.patchsets.at(-1)!;
    const shard = String(c.number % 100).padStart(2, "0");
    return {
      id: `tidepool~main~${c.changeId}`, project: "tidepool", branch: "main", change_id: c.changeId, subject: c.subject, status: "NEW",
      updated: c.updated, _number: c.number, work_in_progress: c.wip || undefined, owner: { name: c.owner, display_name: c.owner },
      current_revision: current.sha,
      revisions: Object.fromEntries(c.patchsets.map((p) => [p.sha, { _number: p.number, created: p.created, kind: p.kind, ref: `refs/changes/${shard}/${c.number}/${p.number}` }])),
    };
  });
  const server = createServer((req, res) => {
    if (req.url?.includes("/changes/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(`)]}'\n${JSON.stringify(body)}`);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  return new Promise<{ port: number; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as AddressInfo).port, close: () => server.close() })),
  );
}

export const takes: Record<string, TakeFn> = {
  async gerrit(ctx) {
    const repo = ctx.demo();
    const changes = gerritify(repo);
    const server = await gerritServer(changes);
    ctx.defer(server.close);
    const { app, page } = await launchGitGud({ userData: `${ctx.work}/ud`, tabs: [repo] });
    ctx.defer(() => app.close());
    // The Gerrit host on screen stays the real-looking one; its requests go to the mock.
    await app.evaluate((_electron, port) => {
      const real = globalThis.fetch;
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        return real(url.replace(/^https:\/\/review\.tidepool\.dev/, `http://127.0.0.1:${port}`), init);
      }) as typeof fetch;
    }, server.port);
    await page.locator(".commit-row").first().waitFor();
    await hideConsole(page);
    const banner = page.locator(".gerrit-banner");
    const t = await ctx.take("gerrit", page);

    await t.line("2.1", async () => {
      await banner.waitFor({ timeout: 15000 });
      await t.cue("banner");
      await callout(t, banner, "Gerrit detected", 3);
      await t.moveTo(banner);
    });
    await t.line("2.2", async () => {
      await t.click(banner.getByRole("button", { name: "Enable Gerrit mode" }));
      await t.cue("host");
      const dialog = page.locator(".modal-panel", { hasText: "Enable Gerrit mode" });
      await t.moveTo(dialog.locator("input").nth(0));
      await t.cue("project");
      await t.moveTo(dialog.locator("input").nth(1));
      await t.cue("branch");
      await t.moveTo(dialog.locator("input").nth(2));
      await t.click(dialog.getByRole("button", { name: "Enable", exact: true }));
    });

    await t.line("3.1", async () => {
      const pill = page.locator(".ref-pill", { hasText: "#101" }).first();
      await pill.waitFor({ timeout: 20000 });
      await t.cue("dashed");
      await callout(t, pill, "Change 101, latest patch set", 3);
      await t.moveTo(pill);
    });
    await t.line("3.2", async () => {
      await t.click(page.locator(".commit-row", { hasText: "search stations by name" }).first().locator(".cr-message"));
      await t.cue("patch");
      await t.moveTo(page.locator(".right-panel").getByText(/patch ?set/i).first());
      await t.cue("browser");
      await t.moveTo(page.getByTitle("Open the change in the browser"));
    });
    await t.line("3.3", async () => {
      await t.click(page.locator(".tb-refs"));
      await t.cue("all");
      await t.click(page.locator(".tb-seg-btn", { hasText: "All" }));
      await t.pause(1.5);
      await t.click(page.locator(".tb-seg-btn", { hasText: "Latest" }));
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    });

    await t.line("4.1", async () => {
      await t.click(page.locator(".tb-btn", { hasText: "Push for review" }));
      const dialog = page.locator(".modal-panel", { hasText: "Topic" });
      await t.cue("topic");
      await t.type(dialog.getByPlaceholder("e.g. login-fix"), "station-search", 60);
      await t.cue("work");
      await t.moveTo(dialog.getByText("WIP", { exact: false }).first());
      await t.cue("private");
      await t.moveTo(dialog.getByText("Private", { exact: false }).first());
    });
    await t.line("4.2", async () => {
      const dialog = page.locator(".modal-panel", { hasText: "Topic" });
      await t.click(dialog.locator(".btn-primary"));
      await t.cue("refuses");
      await t.moveTo(page.locator(".toast-container .toast-body").first());
    });
    await t.line("4.3", async () => {
      // A follow-up edit to amend in; its "Uncommitted changes" row brings back the commit box.
      writeFileSync(`${repo}/docs/search.md`, "# Station search\n\nType part of a name, like \"bat\" for The Battery.\n");
      await page.keyboard.press("Meta+r");
      await t.click(page.locator(".commit-row.is-pseudo .cr-message"));
      await t.click(page.getByText("Amend last commit"));
      await t.cue("patch");
      const hint = page.getByText(/new patchset/i).first();
      await callout(t, hint, "No force-push warning", 3);
      await t.moveTo(hint);
    });
    await t.finish();
  },
};
