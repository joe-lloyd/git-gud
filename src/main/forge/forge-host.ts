// Host-side forge glue: turns `__forge*` RPCs into provider calls, with the
// caching, "needs review" and bot-verdict logic kept provider-agnostic.
// Electron-free — the headless daemon builds one from `forges` in its config.
//
//   phone ── __forgeListPulls ──► ForgeHost ──► ForgejoProvider ──► git.home.arpa
//                                  (caches)       (token, CA)
import { createHash } from "crypto";
import {
  countLines,
  parseBotComment,
  rollupChecks,
  splitUnifiedDiff,
  truncatePatch,
  type BotVerdict,
  type DiffSlice,
  type FileDiff,
  type ForgeInfo,
  type PullCommit,
  type PullDetail,
  type PullFile,
  type PullFileList,
  type PullList,
  type PullRef,
  type PullReviewSummary,
  type PullSummary,
  type RpcErrorCode,
  type StatusCheck,
} from "../peer-protocol";
import { ForgejoProvider } from "./forgejo";
import type { ForgeProvider, ProviderPull } from "./provider";

export type BotConfig = { name: string; context: string; commentMarker?: string };
export const DEFAULT_BOTS: BotConfig[] = [{ name: "JEV", context: "jev/base-review", commentMarker: "<!-- jev-base-review -->" }];

export type ForgeConfig = {
  id: string;
  kind: "forgejo";
  url: string;
  token: string;
  ca?: string;
  owners?: string[];
  bots?: BotConfig[];
};

export type ForgeRpcResult = { ok: true; result: unknown } | { ok: false; error: string; code: RpcErrorCode };

// What the peer server needs (src/main/peer-server.ts routes `__forge*` here).
export interface ForgeRpcHandler {
  enabled(): boolean;
  handle(method: string, args: unknown[]): Promise<ForgeRpcResult>;
}

type Forge = { provider: ForgeProvider; owners: string[]; bots: BotConfig[]; botContexts: Set<string> };

const USER_TTL_MS = 10 * 60_000;
const STATUS_TTL_MS = 30_000;
const HEAD_TTL_MS = 10_000;
const CONCURRENCY = 6;
const DIFF_CACHE_ENTRIES = 30;
const DIFF_CACHE_BYTES = 64 * 1024 * 1024;
// A review on the current head in one of these states means "seen it".
const REVIEWED = new Set(["APPROVED", "REQUEST_CHANGES", "COMMENT"]);

class StaleHead extends Error {
  constructor(public current: string) { super("The pull request has new commits — reload it"); }
}
class BadArgs extends Error {}

type DiffEntry = { files: PullFile[]; slices: Map<string, DiffSlice>; bytes: number };

export class ForgeHost implements ForgeRpcHandler {
  private forges = new Map<string, Forge>();
  private users = new Map<string, { at: number; login: string }>();
  private pulls = new Map<string, { updatedAt: string; at: number; pull: ProviderPull }>();
  private statuses = new Map<string, { at: number; value: StatusCheck[] }>();
  private reviews = new Map<string, { at: number; value: PullReviewSummary[] }>();
  private diffs = new Map<string, DiffEntry>();
  private diffBytes = 0;
  private inflight = new Map<string, Promise<DiffEntry>>();

  constructor(forges: Array<{ provider: ForgeProvider; owners?: string[]; bots?: BotConfig[] }>, private now: () => number = Date.now) {
    for (const f of forges) {
      const bots = f.bots ?? DEFAULT_BOTS;
      this.forges.set(f.provider.id, { provider: f.provider, owners: f.owners ?? [], bots, botContexts: new Set(bots.map((b) => b.context)) });
    }
  }

  enabled(): boolean {
    return this.forges.size > 0;
  }

  async handle(method: string, args: unknown[]): Promise<ForgeRpcResult> {
    try {
      const a = args[0];
      switch (method) {
        case "__forgeInfo": return { ok: true, result: await this.info() };
        case "__forgeListPulls": return { ok: true, result: await this.listPulls(optForge(a)) };
        case "__forgeGetPull": return { ok: true, result: await this.getPull(pullRef(a)) };
        case "__forgeListFiles": return { ok: true, result: await this.listFiles(pullRef(a)) };
        case "__forgeFileDiff": return { ok: true, result: await this.fileDiff(pullRef(a), sha(a, "headSha"), str(a, "path")) };
        case "__forgeListCommits": return { ok: true, result: await this.listCommits(pullRef(a)) };
        default: return { ok: false, error: `Unknown forge method "${method}"`, code: "not-found" };
      }
    } catch (e) {
      if (e instanceof StaleHead) return { ok: false, error: e.message, code: "stale" };
      if (e instanceof BadArgs) return { ok: false, error: e.message, code: "failed" };
      if (e instanceof UnknownForge) return { ok: false, error: e.message, code: "not-found" };
      return { ok: false, error: e instanceof Error ? e.message : String(e), code: "failed" };
    }
  }

  // ── Methods ───────────────────────────────────────────────────────────

  async info(): Promise<ForgeInfo> {
    const forges = await Promise.all([...this.forges.values()].map(async (f) => {
      const base = { id: f.provider.id, kind: f.provider.kind, url: f.provider.url };
      try { return { ...base, user: await this.me(f) }; } catch (e) { return { ...base, user: null, error: errText(e) }; }
    }));
    return { forges };
  }

  async listPulls(only?: string): Promise<PullList> {
    const targets = only ? [this.forge(only)] : [...this.forges.values()];
    const errors: PullList["errors"] = [];
    const rows: PullSummary[] = [];
    await Promise.all(targets.map(async (f) => {
      const id = f.provider.id;
      try {
        const me = await this.me(f);
        const found = f.owners.length
          ? (await Promise.all(f.owners.map((o) => f.provider.searchOpenPulls(o)))).flat()
          : await f.provider.searchOpenPulls();
        const seen = new Set<string>();
        const refs = found.filter((r) => { const k = `${r.repo}#${r.number}`; if (seen.has(k)) return false; seen.add(k); return true; });
        await mapLimit(refs, CONCURRENCY, async (r) => {
          try {
            const pull = await this.pullFor(f, r.repo, r.number, r.updatedAt);
            const [statuses, reviews] = await Promise.all([this.statusesFor(f, pull.repo, pull.headSha), this.reviewsFor(f, pull)]);
            rows.push(this.summary(f, pull, statuses, reviews, me));
          } catch (e) {
            errors.push({ forge: id, error: `${r.repo}#${r.number}: ${errText(e)}` });
          }
        });
      } catch (e) {
        errors.push({ forge: id, error: errText(e) });
      }
    }));
    rows.sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : x.updatedAt > y.updatedAt ? -1 : 0));
    return { pulls: rows, errors };
  }

  async getPull(ref: PullRef): Promise<PullDetail> {
    const f = this.forge(ref.forge);
    const [me, pull] = await Promise.all([this.me(f).catch(() => null), this.freshPull(f, ref.repo, ref.number)]);
    const wantComments = f.bots.some((b) => b.commentMarker);
    const [statuses, reviews, comments] = await Promise.all([
      this.statusesFor(f, pull.repo, pull.headSha, true),
      this.reviewsFor(f, pull, true),
      wantComments ? f.provider.getComments(pull.repo, pull.number) : Promise.resolve([]),
    ]);
    const base = this.summary(f, pull, statuses, reviews, me);
    const bots: BotVerdict[] = base.bots.map((b) => {
      const marker = f.bots.find((x) => x.name === b.name)?.commentMarker;
      const c = marker ? [...comments].reverse().find((x) => x.body.includes(marker)) : undefined;
      if (!c) return b;
      const { headline, focus } = parseBotComment(c.body);
      return { ...b, body: c.body, ...(headline ? { headline } : {}), focus, ...(b.url ? {} : c.url ? { url: c.url } : {}) };
    });
    return { ...base, bots, body: pull.body, mergeable: pull.mergeable, statuses, reviews, me };
  }

  async listFiles(ref: PullRef): Promise<PullFileList> {
    const f = this.forge(ref.forge);
    const head = await this.currentHead(f, ref.repo, ref.number, true);
    const d = await this.diffFor(f, ref.repo, ref.number, head);
    return { headSha: head, files: d.files };
  }

  async fileDiff(ref: PullRef, headSha: string, path: string): Promise<FileDiff> {
    const f = this.forge(ref.forge);
    const head = await this.currentHead(f, ref.repo, ref.number);
    if (head !== headSha) throw new StaleHead(head);
    const d = await this.diffFor(f, ref.repo, ref.number, head);
    const slice = d.slices.get(path);
    if (!slice) throw new BadArgs(`"${path}" is not part of this pull request`);
    const { patch, truncated } = slice.binary ? { patch: "", truncated: false } : truncatePatch(slice.patch);
    return { path, headSha: head, patch, truncated, binary: slice.binary, lines: countLines(slice.patch) };
  }

  listCommits(ref: PullRef): Promise<PullCommit[]> {
    const f = this.forge(ref.forge);
    return f.provider.getCommits(ref.repo, ref.number);
  }

  /** `gitgud-headless forge check`: who the token is and how many PRs it sees. */
  async check(): Promise<Array<{ id: string; url: string; user: string | null; openPulls: number | null; error?: string }>> {
    return Promise.all([...this.forges.values()].map(async (f) => {
      const base = { id: f.provider.id, url: f.provider.url };
      try {
        const user = await this.me(f);
        const pulls = f.owners.length ? (await Promise.all(f.owners.map((o) => f.provider.searchOpenPulls(o)))).flat() : await f.provider.searchOpenPulls();
        return { ...base, user, openPulls: pulls.length };
      } catch (e) {
        return { ...base, user: null, openPulls: null, error: errText(e) };
      }
    }));
  }

  // ── Composition ───────────────────────────────────────────────────────

  private summary(f: Forge, pull: ProviderPull, statuses: StatusCheck[], reviews: PullReviewSummary[], me: string | null): PullSummary {
    const bots: BotVerdict[] = f.bots.map((b) => {
      const s = statuses.find((x) => x.context === b.context);
      return { name: b.name, context: b.context, state: s?.state ?? "none", description: s?.description ?? "", ...(s?.url ? { url: s.url } : {}) };
    });
    return {
      forge: f.provider.id,
      repo: pull.repo,
      number: pull.number,
      title: pull.title,
      author: pull.author,
      draft: pull.draft,
      createdAt: pull.createdAt,
      updatedAt: pull.updatedAt,
      headSha: pull.headSha,
      base: pull.base,
      head: pull.head,
      add: pull.add,
      del: pull.del,
      files: pull.files,
      comments: pull.comments,
      checks: rollupChecks(statuses, f.botContexts),
      bots,
      needsReview: needsReview(pull, reviews, me),
      url: pull.url,
    };
  }

  // ── Caches ────────────────────────────────────────────────────────────

  private forge(id: string): Forge {
    const f = this.forges.get(id);
    if (!f) throw new UnknownForge(`No forge "${id}" on this host`);
    return f;
  }

  private async me(f: Forge): Promise<string> {
    const c = this.users.get(f.provider.id);
    if (c && this.now() - c.at < USER_TTL_MS) return c.login;
    const login = await f.provider.whoami();
    this.users.set(f.provider.id, { at: this.now(), login });
    return login;
  }

  // Inbox: the search hit's updated_at says whether the cached PR is current.
  private async pullFor(f: Forge, repo: string, number: number, updatedAt: string): Promise<ProviderPull> {
    const k = `${f.provider.id}|${repo}#${number}`;
    const c = this.pulls.get(k);
    if (c && updatedAt && c.updatedAt === updatedAt) return c.pull;
    return this.freshPull(f, repo, number);
  }

  private async freshPull(f: Forge, repo: string, number: number): Promise<ProviderPull> {
    const pull = await f.provider.getPull(repo, number);
    this.pulls.set(`${f.provider.id}|${repo}#${number}`, { updatedAt: pull.updatedAt, at: this.now(), pull });
    return pull;
  }

  private async currentHead(f: Forge, repo: string, number: number, fresh = false): Promise<string> {
    const c = this.pulls.get(`${f.provider.id}|${repo}#${number}`);
    if (!fresh && c && this.now() - c.at < HEAD_TTL_MS) return c.pull.headSha;
    return (await this.freshPull(f, repo, number)).headSha;
  }

  private async statusesFor(f: Forge, repo: string, sha: string, fresh = false): Promise<StatusCheck[]> {
    const k = `${f.provider.id}|${repo}@${sha}`;
    const c = this.statuses.get(k);
    if (!fresh && c && this.now() - c.at < STATUS_TTL_MS) return c.value;
    const value = await f.provider.getStatuses(repo, sha);
    this.statuses.set(k, { at: this.now(), value });
    return value;
  }

  private async reviewsFor(f: Forge, pull: ProviderPull, fresh = false): Promise<PullReviewSummary[]> {
    // Submitting a review bumps the PR's updated_at, so that is in the key.
    const k = `${f.provider.id}|${pull.repo}#${pull.number}@${pull.headSha}@${pull.updatedAt}`;
    const c = this.reviews.get(k);
    if (!fresh && c && this.now() - c.at < STATUS_TTL_MS) return c.value;
    const value = await f.provider.getReviews(pull.repo, pull.number);
    this.reviews.set(k, { at: this.now(), value });
    return value;
  }

  // One diff fetch per head, sliced per file, LRU by count and bytes.
  private async diffFor(f: Forge, repo: string, number: number, head: string): Promise<DiffEntry> {
    const k = `${f.provider.id}|${repo}#${number}@${head}`;
    const hit = this.diffs.get(k);
    if (hit) { this.diffs.delete(k); this.diffs.set(k, hit); return hit; }
    const running = this.inflight.get(k);
    if (running) return running;
    const p = (async () => {
      const text = await f.provider.getDiff(repo, number);
      // The diff endpoint serves whatever the head is *now*: make sure that is
      // still the head we were asked about, or we'd cache B under A's key.
      const after = (await this.freshPull(f, repo, number)).headSha;
      if (after !== head) throw new StaleHead(after);
      const slices = new Map<string, DiffSlice>();
      const files: PullFile[] = [];
      for (const s of splitUnifiedDiff(text)) {
        slices.set(s.path, s);
        files.push({
          path: s.path,
          ...(s.previous ? { previous: s.previous } : {}),
          status: s.status,
          add: s.add,
          del: s.del,
          binary: s.binary,
          lines: countLines(s.patch),
          patchHash: createHash("sha256").update(s.patch, "utf8").digest("hex").slice(0, 24),
        });
      }
      const entry: DiffEntry = { files, slices, bytes: text.length };
      this.diffs.set(k, entry);
      this.diffBytes += entry.bytes;
      while (this.diffs.size > DIFF_CACHE_ENTRIES || (this.diffBytes > DIFF_CACHE_BYTES && this.diffs.size > 1)) {
        const [oldest, e] = this.diffs.entries().next().value as [string, DiffEntry];
        this.diffs.delete(oldest);
        this.diffBytes -= e.bytes;
      }
      return entry;
    })();
    this.inflight.set(k, p);
    try { return await p; } finally { this.inflight.delete(k); }
  }
}

class UnknownForge extends Error {}

/** Open, not a draft, and either you were asked or you haven't reviewed this head. */
export function needsReview(pull: Pick<ProviderPull, "state" | "draft" | "headSha" | "requestedReviewers">, reviews: PullReviewSummary[], me: string | null): boolean {
  if (pull.state !== "open" || pull.draft) return false;
  if (!me) return true;
  if (pull.requestedReviewers.includes(me)) return true;
  return !reviews.some((r) => r.user === me && r.commitId === pull.headSha && REVIEWED.has(r.state));
}

export function createForgeHost(configs: ForgeConfig[]): ForgeHost {
  return new ForgeHost(configs.map((c) => ({
    provider: new ForgejoProvider({ id: c.id, url: c.url, token: c.token, ca: c.ca }),
    owners: c.owners,
    bots: c.bots,
  })));
}

// ── Argument parsing ───────────────────────────────────────────────────

// owner/name in Forgejo's own character set. No "." / ".." segments: the
// request URL is resolved, so a dot segment could aim the token elsewhere.
const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const isRepo = (r: string) => { const p = r.split("/"); return p.length === 2 && p.every((x) => NAME_RE.test(x) && x !== "." && x !== ".."); };

function pullRef(a: unknown): PullRef {
  const o = (a ?? {}) as Record<string, unknown>;
  if (typeof o.forge !== "string" || !o.forge) throw new BadArgs("forge is required");
  if (typeof o.repo !== "string" || !isRepo(o.repo)) throw new BadArgs("repo must be owner/name");
  if (typeof o.number !== "number" || !Number.isInteger(o.number) || o.number < 1) throw new BadArgs("number must be a positive integer");
  return { forge: o.forge, repo: o.repo, number: o.number };
}

function optForge(a: unknown): string | undefined {
  const f = (a as { forge?: unknown } | undefined)?.forge;
  return typeof f === "string" && f ? f : undefined;
}

function str(a: unknown, key: string): string {
  const v = (a as Record<string, unknown> | undefined)?.[key];
  if (typeof v !== "string" || !v) throw new BadArgs(`${key} is required`);
  return v;
}

function sha(a: unknown, key: string): string {
  const v = str(a, key);
  if (!/^[0-9a-f]{7,64}$/i.test(v)) throw new BadArgs(`${key} must be a commit sha`);
  return v;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}
