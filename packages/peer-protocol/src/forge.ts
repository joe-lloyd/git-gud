// Forge (pull request) part of the peer protocol. A host with a forge
// configured (gitgud-headless `forges`) answers these host-level methods; the
// token stays on the host and only these normalised shapes cross the wire.
// Pure TypeScript like the rest of the package — the guards below are what
// the companion runs on every forge result instead of casting `unknown`.
//
//   __forgeInfo()                                  → ForgeInfo
//   __forgeListPulls({ forge? })                   → PullList
//   __forgeGetPull(PullRef)                        → PullDetail
//   __forgeListFiles(PullRef)                      → PullFileList
//   __forgeFileDiff(PullRef & { headSha, path })   → FileDiff   (code "stale" when the head moved)
//   __forgeListCommits(PullRef)                    → PullCommit[]

export const FORGE_FEATURE = "forge";

export const FORGE_READ_METHODS: ReadonlySet<string> = new Set([
  "__forgeInfo",
  "__forgeListPulls",
  "__forgeGetPull",
  "__forgeListFiles",
  "__forgeFileDiff",
  "__forgeListCommits",
]);

export function isForgeMethod(method: string): boolean {
  return method.startsWith("__forge");
}

// Per-file patches larger than this are cut at a line boundary and flagged.
export const FORGE_MAX_FILE_PATCH_CHARS = 300_000;

// ── Types ───────────────────────────────────────────────────────────────

export type StatusState = "pending" | "success" | "error" | "failure" | "warning" | "skipped";
// Belt rollup over every non-bot status context of a head.
export type ChecksRollup = "success" | "pending" | "warning" | "failure" | "none";

export type StatusCheck = { context: string; state: StatusState; description: string; url?: string };

// A review bot (JEV) — its commit status plus, on the detail view, the
// headline and review-focus bullets lifted from its comment.
export type BotVerdict = {
  name: string;
  // The status context this bot reports on (excluded from the belt rollup).
  context?: string;
  state: StatusState | "none";
  description: string;
  url?: string;
  headline?: string;
  focus?: string[];
  body?: string;
};

export type ForgeSummary = { id: string; kind: string; url: string; user: string | null; error?: string };
export type ForgeInfo = { forges: ForgeSummary[] };

export type PullRef = { forge: string; repo: string; number: number };

export type PullSummary = PullRef & {
  title: string;
  author: string;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  headSha: string;
  base: string;
  head: string;
  add: number;
  del: number;
  files: number;
  comments: number;
  checks: ChecksRollup;
  bots: BotVerdict[];
  needsReview: boolean;
  url: string;
};

export type PullList = { pulls: PullSummary[]; errors: Array<{ forge: string; error: string }> };

export type PullReviewSummary = { user: string; state: string; submittedAt: string; commitId: string; body: string; stale: boolean };

export type PullDetail = PullSummary & {
  body: string;
  mergeable: boolean | null;
  statuses: StatusCheck[];
  reviews: PullReviewSummary[];
  me: string | null;
};

export type PullFileStatus = "added" | "modified" | "deleted" | "renamed" | "copied";
export type PullFile = {
  path: string;
  previous?: string;
  status: PullFileStatus;
  add: number;
  del: number;
  binary: boolean;
  // Lines in the patch (hunk headers included) — the phone collapses big ones.
  lines: number;
  // Changes exactly when this file's patch changes — keys "viewed" state.
  patchHash: string;
};
export type PullFileList = { headSha: string; files: PullFile[] };

export type FileDiff = { path: string; headSha: string; patch: string; truncated: boolean; binary: boolean; lines: number };

export type PullCommit = { sha: string; subject: string; author: string; date: string };

// ── Pure helpers shared by host and phone ───────────────────────────────

const STATE_RANK: Record<StatusState, number> = { failure: 4, error: 4, pending: 3, warning: 2, success: 1, skipped: 0 };

/** Belt rollup: any failure/error → failure, then pending, then warning; skipped counts as success. */
export function rollupChecks(statuses: StatusCheck[], botContexts: ReadonlySet<string> = new Set()): ChecksRollup {
  const belt = statuses.filter((s) => !botContexts.has(s.context));
  if (!belt.length) return "none";
  const worst = belt.reduce((w, s) => (STATE_RANK[s.state] > STATE_RANK[w] ? s.state : w), "skipped" as StatusState);
  if (worst === "failure" || worst === "error") return "failure";
  if (worst === "pending") return "pending";
  if (worst === "warning") return "warning";
  return "success";
}

/**
 * Lift the headline and review-focus bullets out of a bot comment. Shape
 * (JEV): marker, `## Title`, blank, headline line(s), `### Review focus`,
 * bullets. Tolerant: anything missing just comes back undefined/empty.
 */
export function parseBotComment(body: string): { headline?: string; focus: string[] } {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let headline: string | undefined;
  let seenTitle = false;
  const focus: string[] = [];
  let inFocus = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (/^#{1,6}\s/.test(l)) {
      if (/^##\s/.test(l)) seenTitle = true;
      inFocus = /^#{2,6}\s+review focus\b/i.test(l);
      continue;
    }
    if (inFocus) {
      if (/^[-*]\s+/.test(l)) focus.push(l.replace(/^[-*]\s+/, ""));
      else if (l && !l.startsWith("<!--")) inFocus = false;
      continue;
    }
    if (seenTitle && !headline && l && !l.startsWith("<!--") && !l.startsWith("|")) headline = l;
  }
  return { headline, focus };
}

export type DiffSlice = { path: string; previous?: string; status: PullFileStatus; binary: boolean; add: number; del: number; patch: string };

/**
 * Split a `git diff`-style unified diff (Forgejo's `pulls/{n}.diff`) into one
 * slice per file. Each slice keeps its `diff --git` header so it is a valid
 * patch on its own. Handles new/deleted/renamed/copied files, mode-only
 * changes, binaries and C-quoted paths.
 */
export function splitUnifiedDiff(diff: string): DiffSlice[] {
  const text = diff.replace(/\r\n/g, "\n");
  const out: DiffSlice[] = [];
  const starts: number[] = [];
  const re = /^diff --git /gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) starts.push(m.index);
  for (let i = 0; i < starts.length; i++) {
    const chunk = text.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : text.length).replace(/\n+$/, "");
    out.push(parseFileChunk(chunk));
  }
  return out;
}

function parseFileChunk(chunk: string): DiffSlice {
  const lines = chunk.split("\n");
  const header = parseGitHeader(lines[0]);
  let oldPath = header?.a, newPath = header?.b;
  let status: PullFileStatus = "modified";
  let binary = false;
  let add = 0, del = 0;
  let inHunk = false;
  let oldLeft = 0, newLeft = 0;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (inHunk && (oldLeft > 0 || newLeft > 0)) {
      if (l.startsWith("+")) { add++; newLeft--; }
      else if (l.startsWith("-")) { del++; oldLeft--; }
      else if (l.startsWith("\\")) { /* no newline marker */ }
      else { oldLeft--; newLeft--; }
      continue;
    }
    inHunk = false;
    const h = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(l);
    if (h) { inHunk = true; oldLeft = h[1] === undefined ? 1 : Number(h[1]); newLeft = h[2] === undefined ? 1 : Number(h[2]); continue; }
    if (l.startsWith("new file mode")) status = "added";
    else if (l.startsWith("deleted file mode")) status = "deleted";
    else if (l.startsWith("rename from ")) { status = "renamed"; oldPath = unquotePath(l.slice(12)); }
    else if (l.startsWith("rename to ")) { status = "renamed"; newPath = unquotePath(l.slice(10)); }
    else if (l.startsWith("copy from ")) { status = "copied"; oldPath = unquotePath(l.slice(10)); }
    else if (l.startsWith("copy to ")) { status = "copied"; newPath = unquotePath(l.slice(8)); }
    else if (l.startsWith("--- ")) { const p = stripPrefix(unquotePath(l.slice(4)), "a/"); if (p !== "/dev/null") oldPath = p; else status = "added"; }
    else if (l.startsWith("+++ ")) { const p = stripPrefix(unquotePath(l.slice(4)), "b/"); if (p !== "/dev/null") newPath = p; else status = "deleted"; }
    else if (l.startsWith("Binary files ") || l === "GIT binary patch") binary = true;
  }
  const path = (status === "deleted" ? oldPath ?? newPath : newPath ?? oldPath) ?? "";
  const slice: DiffSlice = { path, status, binary, add, del, patch: chunk };
  if ((status === "renamed" || status === "copied") && oldPath && oldPath !== path) slice.previous = oldPath;
  return slice;
}

// `diff --git a/x b/x` — paths may be C-quoted, and unquoted ones may contain
// spaces (then a and b are equal, so split in the middle).
function parseGitHeader(line: string): { a: string; b: string } | null {
  const rest = line.replace(/^diff --git /, "");
  if (rest.startsWith('"')) {
    const end = closingQuote(rest, 0);
    const a = unquotePath(rest.slice(0, end + 1));
    const bRaw = rest.slice(end + 2);
    return { a: stripPrefix(a, "a/"), b: stripPrefix(unquotePath(bRaw), "b/") };
  }
  const qb = rest.indexOf(' "b/');
  if (qb >= 0) return { a: stripPrefix(rest.slice(0, qb), "a/"), b: stripPrefix(unquotePath(rest.slice(qb + 1)), "b/") };
  if (rest.startsWith("a/")) {
    const half = (rest.length - 1) / 2;
    if (Number.isInteger(half) && rest.slice(half, half + 3) === " b/" && rest.slice(2, half) === rest.slice(half + 3)) {
      return { a: rest.slice(2, half), b: rest.slice(half + 3) };
    }
    const sp = rest.indexOf(" b/");
    if (sp > 0) return { a: rest.slice(2, sp), b: rest.slice(sp + 3) };
  }
  return null;
}

function closingQuote(s: string, open: number): number {
  for (let i = open + 1; i < s.length; i++) {
    if (s[i] === "\\") { i++; continue; }
    if (s[i] === '"') return i;
  }
  return s.length - 1;
}

function stripPrefix(p: string, prefix: string): string {
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

const ESCAPES: Record<string, number> = { n: 10, t: 9, r: 13, b: 8, f: 12, v: 11, a: 7, "\\": 92, '"': 34 };

/** git's C-style path quoting: `"a/caf\303\251.txt"` → `a/café.txt`. Unquoted input passes through (minus a trailing tab git adds for spaces). */
export function unquotePath(s: string): string {
  const t = s.replace(/\t$/, "");
  if (!(t.startsWith('"') && t.endsWith('"') && t.length >= 2)) return t;
  const bytes: number[] = [];
  const body = t.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "\\") { for (const b of utf8(c)) bytes.push(b); continue; }
    const n = body[i + 1];
    if (/[0-7]/.test(n ?? "")) { bytes.push(parseInt(body.slice(i + 1, i + 4), 8) & 0xff); i += 3; continue; }
    bytes.push(ESCAPES[n] ?? n.charCodeAt(0)); i++;
  }
  return decodeUtf8(bytes);
}

function utf8(ch: string): number[] {
  const cp = ch.codePointAt(0)!;
  if (cp < 0x80) return [cp];
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 63)];
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
}

// Minimal UTF-8 decoder (no TextDecoder dependency on any runtime). Invalid
// sequences become U+FFFD.
function decodeUtf8(b: number[]): string {
  let s = "";
  for (let i = 0; i < b.length; ) {
    const x = b[i];
    let cp = 0xfffd, n = 1;
    if (x < 0x80) cp = x;
    else if (x >> 5 === 6 && i + 1 < b.length) { cp = ((x & 31) << 6) | (b[i + 1] & 63); n = 2; }
    else if (x >> 4 === 14 && i + 2 < b.length) { cp = ((x & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63); n = 3; }
    else if (x >> 3 === 30 && i + 3 < b.length) { cp = ((x & 7) << 18) | ((b[i + 1] & 63) << 12) | ((b[i + 2] & 63) << 6) | (b[i + 3] & 63); n = 4; }
    s += String.fromCodePoint(cp);
    i += n;
  }
  return s;
}

/** Cut a patch at a line boundary so it stays under `max` characters. */
export function truncatePatch(patch: string, max = FORGE_MAX_FILE_PATCH_CHARS): { patch: string; truncated: boolean } {
  if (patch.length <= max) return { patch, truncated: false };
  const cut = patch.lastIndexOf("\n", max);
  return { patch: patch.slice(0, cut > 0 ? cut : max), truncated: true };
}

export function countLines(s: string): number {
  if (!s) return 0;
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

// ── Runtime guards (phone side) ─────────────────────────────────────────
// Each returns null when the value doesn't have the shape this client was
// built for — the caller turns that into one clear error instead of a
// half-rendered screen.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const optStr = (v: unknown) => v === undefined || isStr(v);
const STATES = new Set(["pending", "success", "error", "failure", "warning", "skipped"]);
const ROLLUPS = new Set(["success", "pending", "warning", "failure", "none"]);
const FILE_STATUSES = new Set(["added", "modified", "deleted", "renamed", "copied"]);

function arrayOf<T>(v: unknown, item: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const x of v) { const p = item(x); if (p === null) return null; out.push(p); }
  return out;
}

export function parseStatusCheck(v: unknown): StatusCheck | null {
  if (!isObj(v) || !isStr(v.context) || !isStr(v.state) || !STATES.has(v.state) || !isStr(v.description) || !optStr(v.url)) return null;
  return v as StatusCheck;
}

export function parseBotVerdict(v: unknown): BotVerdict | null {
  if (!isObj(v) || !isStr(v.name) || !isStr(v.state) || !(STATES.has(v.state) || v.state === "none") || !isStr(v.description)) return null;
  if (!optStr(v.url) || !optStr(v.headline) || !optStr(v.body) || !optStr(v.context)) return null;
  if (v.focus !== undefined && arrayOf(v.focus, (x) => (isStr(x) ? x : null)) === null) return null;
  return v as BotVerdict;
}

export function parsePullSummary(v: unknown): PullSummary | null {
  if (!isObj(v)) return null;
  const strs = ["forge", "repo", "title", "author", "createdAt", "updatedAt", "headSha", "base", "head", "url"] as const;
  const nums = ["number", "add", "del", "files", "comments"] as const;
  if (strs.some((k) => !isStr(v[k])) || nums.some((k) => !isNum(v[k]))) return null;
  if (!isBool(v.draft) || !isBool(v.needsReview) || !isStr(v.checks) || !ROLLUPS.has(v.checks)) return null;
  if (arrayOf(v.bots, parseBotVerdict) === null) return null;
  return v as PullSummary;
}

export function parsePullList(v: unknown): PullList | null {
  if (!isObj(v)) return null;
  const pulls = arrayOf(v.pulls, parsePullSummary);
  const errors = arrayOf(v.errors, (e) => (isObj(e) && isStr(e.forge) && isStr(e.error) ? (e as PullList["errors"][number]) : null));
  return pulls && errors ? { pulls, errors } : null;
}

export function parsePullDetail(v: unknown): PullDetail | null {
  if (!parsePullSummary(v)) return null;
  const o = v as Obj;
  if (!isStr(o.body) || !(o.mergeable === null || isBool(o.mergeable)) || !(o.me === null || isStr(o.me))) return null;
  if (arrayOf(o.statuses, parseStatusCheck) === null) return null;
  const reviews = arrayOf(o.reviews, (r) =>
    isObj(r) && isStr(r.user) && isStr(r.state) && isStr(r.submittedAt) && isStr(r.commitId) && isStr(r.body) && isBool(r.stale) ? (r as PullReviewSummary) : null);
  return reviews ? (o as PullDetail) : null;
}

export function parsePullFile(v: unknown): PullFile | null {
  if (!isObj(v) || !isStr(v.path) || !optStr(v.previous) || !isStr(v.status) || !FILE_STATUSES.has(v.status)) return null;
  if (!isNum(v.add) || !isNum(v.del) || !isNum(v.lines) || !isBool(v.binary) || !isStr(v.patchHash)) return null;
  return v as PullFile;
}

export function parsePullFileList(v: unknown): PullFileList | null {
  if (!isObj(v) || !isStr(v.headSha)) return null;
  const files = arrayOf(v.files, parsePullFile);
  return files ? { headSha: v.headSha, files } : null;
}

export function parseFileDiff(v: unknown): FileDiff | null {
  if (!isObj(v) || !isStr(v.path) || !isStr(v.headSha) || !isStr(v.patch) || !isBool(v.truncated) || !isBool(v.binary) || !isNum(v.lines)) return null;
  return v as FileDiff;
}

export function parsePullCommits(v: unknown): PullCommit[] | null {
  return arrayOf(v, (c) => (isObj(c) && isStr(c.sha) && isStr(c.subject) && isStr(c.author) && isStr(c.date) ? (c as PullCommit) : null));
}

export function parseForgeInfo(v: unknown): ForgeInfo | null {
  if (!isObj(v)) return null;
  const forges = arrayOf(v.forges, (f) =>
    isObj(f) && isStr(f.id) && isStr(f.kind) && isStr(f.url) && (f.user === null || isStr(f.user)) && optStr(f.error) ? (f as ForgeSummary) : null);
  return forges ? { forges } : null;
}
