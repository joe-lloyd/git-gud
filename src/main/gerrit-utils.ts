import * as fs from "fs";
import { join } from "path";

// Pure Gerrit helpers: detection heuristics, refspec building, and REST
// plumbing that needs no electron APIs — kept apart from GerritService so
// tests can import them without an electron runtime.

export type GerritDetection = {
  likely: boolean;
  signals: string[];
  remote?: string;
  host?: string;
  project?: string;
  defaultBranch?: string;
};

export type PushForReviewOptions = {
  remote: string;
  targetBranch: string;
  topic?: string;
  wip?: boolean;
  ready?: boolean;
  private?: boolean;
};

// One patchset (amendment) of a change, newest first in GerritChange.
export type GerritPatchset = {
  sha: string;
  number: number;
  created: string;
  kind: string; // REWORK | TRIVIAL_REBASE | NO_CODE_CHANGE | NO_CHANGE | …
};

export type GerritChange = {
  id: string;
  number: number;
  subject: string;
  owner: string;
  branch: string;
  patchset: number;
  wip: boolean;
  updated: string;
  url: string;
  // Current patchset commit + its server ref (refs/changes/NN/<n>/<ps>) —
  // what the graph fetches to render the change as a real node.
  currentSha?: string;
  currentRef?: string;
  // Full amendment history (all patchsets), newest first.
  patchsets: GerritPatchset[];
};

type RemoteInfo = { name: string; url: string };

// ── Detection ────────────────────────────────────────────────────────────────

// Parse the ini-ish `.gitreview` file. Only the [gerrit] section matters:
//   host=review.example.org  port=29418  project=foo/bar  defaultbranch=main
export function parseGitReview(content: string): {
  host?: string;
  port?: string;
  project?: string;
  defaultBranch?: string;
} {
  const out: Record<string, string> = {};
  let inGerrit = false;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) {
      inGerrit = section[1].trim().toLowerCase() === "gerrit";
      continue;
    }
    if (!inGerrit) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
  }
  return {
    host: out.host,
    port: out.port,
    project: out.project?.replace(/\.git$/i, ""),
    defaultBranch: out.defaultbranch,
  };
}

// Does this remote URL look like a Gerrit server? Conservative heuristics:
// the canonical SSH port, "gerrit" appearing in host or path, known Gerrit
// hosting (googlesource.com is Google's hosted Gerrit), the `review.` /
// `-review.` host convention, or the authenticated-HTTP `/a/` path prefix.
export function urlLooksLikeGerrit(url: string): boolean {
  if (/:29418(\/|$)/.test(url.trim())) return true;
  const parsed = parseRemoteUrl(url);
  if (!parsed) return false;
  if (parsed.port === "29418") return true;
  if (/(^|[.-])gerrit([.-]|$)/i.test(parsed.host)) return true;
  if (/(^|\.)googlesource\.com$/i.test(parsed.host)) return true;
  if (/^review\./i.test(parsed.host) || /-review\./i.test(parsed.host)) return true;
  if (/(^|\/)gerrit(\/|$)/i.test(parsed.path)) return true;
  if (/^\/a\//.test(parsed.path) && parsed.protocol.startsWith("http")) return true;
  return false;
}

// Split any git remote URL shape (https://, ssh://, scp-like git@host:path)
// into host + path. Returns null for things that don't parse.
export function parseRemoteUrl(
  url: string,
): { protocol: string; host: string; port?: string; path: string } | null {
  const trimmed = url.trim();
  const full = /^(\w+):\/\/(?:[^@/]+@)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(trimmed);
  if (full) {
    return { protocol: full[1], host: full[2], port: full[3], path: full[4] ?? "/" };
  }
  const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(trimmed);
  if (scp && !trimmed.includes("://")) {
    return { protocol: "ssh", host: scp[1], path: "/" + scp[2] };
  }
  return null;
}

// Derive the Gerrit project name from a remote URL path: strip the leading
// slash, the `/a/` auth prefix, and the `.git` suffix.
export function projectFromRemoteUrl(url: string): string | undefined {
  const parsed = parseRemoteUrl(url);
  if (!parsed) return undefined;
  const project = parsed.path
    .replace(/^\/+/, "")
    .replace(/^a\//, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  return project || undefined;
}

// Best-effort HTTPS base URL for the REST API / web links. Only derivable
// from http(s) remotes — SSH remotes give a host but we can't guess the web
// port/scheme reliably, so the enable flow asks the user instead.
export function hostFromRemoteUrl(url: string): string | undefined {
  const parsed = parseRemoteUrl(url);
  if (!parsed || !parsed.protocol.startsWith("http")) return undefined;
  const port = parsed.port ? `:${parsed.port}` : "";
  return canonicalGerritRestHost(`${parsed.protocol}://${parsed.host}${port}`);
}

// googlesource serves git/gitiles on `X.googlesource.com` but the Gerrit UI
// and REST API on `X-review.googlesource.com` — /changes/ 404s on the clone
// host. Map to the -review host; anything else passes through unchanged.
// (A renderer twin lives in src/renderer/lib/gerritHost.ts.)
export function canonicalGerritRestHost(host: string): string {
  return host.replace(
    /^(https?:\/\/)([a-z0-9-]+)(\.googlesource\.com)(?=$|[:/])/i,
    (_m, proto, sub, dom) => (sub.toLowerCase().endsWith("-review") ? _m : `${proto}${sub}-review${dom}`),
  );
}

export function detectGerrit(repoPath: string, remotes: RemoteInfo[]): GerritDetection {
  const signals: string[] = [];
  let host: string | undefined;
  let project: string | undefined;
  let defaultBranch: string | undefined;
  let matchedRemote: RemoteInfo | undefined;

  // 1) .gitreview — authoritative when present.
  try {
    const reviewPath = join(repoPath, ".gitreview");
    if (fs.existsSync(reviewPath)) {
      const parsed = parseGitReview(fs.readFileSync(reviewPath, "utf-8"));
      if (parsed.host || parsed.project) {
        signals.push(".gitreview");
        if (parsed.host) host = `https://${parsed.host}`;
        project = parsed.project;
        defaultBranch = parsed.defaultBranch;
      }
    }
  } catch {
    /* unreadable — skip the signal */
  }

  // 2) Remote URL heuristics.
  for (const remote of remotes) {
    if (urlLooksLikeGerrit(remote.url)) {
      signals.push(`remote-url:${remote.name}`);
      matchedRemote = remote;
      break;
    }
  }
  // Preferred remote for pushes: the matched one, else origin, else first.
  const pushRemote =
    matchedRemote ?? remotes.find((r) => r.name === "origin") ?? remotes[0];
  if (pushRemote) {
    host ??= hostFromRemoteUrl(pushRemote.url);
    project ??= projectFromRemoteUrl(pushRemote.url);
  }

  // 3) commit-msg hook that inserts a Change-Id.
  try {
    const hookPath = join(repoPath, ".git", "hooks", "commit-msg");
    if (fs.existsSync(hookPath)) {
      const hook = fs.readFileSync(hookPath, "utf-8");
      if (hook.includes("Change-Id")) signals.push("commit-msg-hook");
    }
  } catch {
    /* unreadable — skip the signal */
  }

  // Signal 4 (Change-Id trailers in recent commits) is evaluated renderer-side
  // from the already-loaded log, so no extra git call happens here.

  return {
    likely: signals.length > 0,
    signals,
    remote: pushRemote?.name,
    host,
    project,
    defaultBranch,
  };
}

// ── Review push refspec ──────────────────────────────────────────────────────

// Build `HEAD:refs/for/<branch>[%opt,opt…]` per Gerrit push-option syntax.
export function buildReviewRefspec(opts: PushForReviewOptions): string {
  const push: string[] = [];
  if (opts.topic?.trim()) push.push(`topic=${opts.topic.trim()}`);
  if (opts.wip) push.push("wip");
  if (opts.ready) push.push("ready");
  if (opts.private) push.push("private");
  const suffix = push.length ? `%${push.join(",")}` : "";
  return `HEAD:refs/for/${opts.targetBranch}${suffix}`;
}

export type ReviewPushErrorKind = "missing-change-id" | "no-new-changes" | "unknown";

export function classifyReviewPushError(msg: string): ReviewPushErrorKind {
  if (/missing Change-Id in message footer/i.test(msg)) return "missing-change-id";
  if (/no new changes/i.test(msg)) return "no-new-changes";
  return "unknown";
}

// ── REST plumbing ────────────────────────────────────────────────────────────

export const normalizeGerritHost = (host: string) => host.trim().replace(/\/+$/, "");

// Build a `Cookie:` header value for `host` from a Netscape-format cookie
// file (git's `http.cookiefile`, e.g. ~/.gitcookies as used by googlesource).
// This lets the REST client authenticate exactly like the user's git does,
// with no extra credentials. Fields: domain, includeSubdomains, path,
// secure, expires, name, value (tab-separated); curl may prefix lines with
// `#HttpOnly_`. Returns undefined when nothing matches.
export function cookieHeaderForHost(
  cookieFileContent: string,
  host: string,
  nowMs: number = Date.now(),
): string | undefined {
  const hostname = host.replace(/^\w+:\/\//, "").replace(/[:/].*$/, "").toLowerCase();
  const cookies: string[] = [];
  for (const rawLine of cookieFileContent.split("\n")) {
    const line = rawLine.replace(/^#HttpOnly_/i, "");
    if (!line.trim() || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 7) continue;
    const domain = parts[0].trim().toLowerCase();
    const expires = Number(parts[4]);
    const name = parts[5].trim();
    const value = parts.slice(6).join("\t").trim();
    if (!domain || !name) continue;
    if (Number.isFinite(expires) && expires > 0 && expires * 1000 < nowMs) continue;
    const bare = domain.replace(/^\./, "");
    const matches = hostname === bare || hostname.endsWith(`.${bare}`);
    if (matches) cookies.push(`${name}=${value}`);
  }
  return cookies.length ? cookies.join("; ") : undefined;
}

// Gerrit prefixes every JSON response with `)]}'` to defeat XSSI.
export function stripXssiPrefix(body: string): string {
  return body.replace(/^\)\]\}'\n?/, "");
}

// Map one entry of Gerrit's /changes/ response to the renderer shape.
export function mapGerritChange(host: string, c: any): GerritChange {
  const currentRev = c.current_revision ? c.revisions?.[c.current_revision] : undefined;
  const patchsets: GerritPatchset[] = Object.entries(c.revisions ?? {})
    .map(([sha, r]: [string, any]) => ({
      sha,
      number: r?._number ?? 0,
      created: r?.created ?? "",
      kind: r?.kind ?? "",
    }))
    .sort((a, b) => b.number - a.number);
  return {
    id: c.change_id ?? "",
    number: c._number ?? 0,
    subject: c.subject ?? "",
    owner: c.owner?.display_name || c.owner?.name || c.owner?.username || "unknown",
    branch: c.branch ?? "",
    patchset: currentRev?._number ?? 0,
    wip: Boolean(c.work_in_progress),
    updated: c.updated ?? "",
    url: `${normalizeGerritHost(host)}/c/${encodeURIComponent(c.project ?? "")}/+/${c._number ?? ""}`,
    currentSha: c.current_revision || undefined,
    currentRef: currentRev?.ref || undefined,
    patchsets,
  };
}

// Local namespace holding fetched patchset refs so open changes render as
// graph nodes. Scoped under refs/gitgud/ so cleanup can never touch user refs.
export const CHANGE_REF_PREFIX = "refs/gitgud/changes/";

// Fetch refspecs for the open changes' current patchsets:
//   +refs/changes/34/1234/5:refs/gitgud/changes/1234
export function buildChangeRefFetchSpecs(
  changes: Array<{ number: number; currentRef?: string }>,
): string[] {
  return changes
    .filter((c) => c.number > 0 && c.currentRef?.startsWith("refs/changes/"))
    .map((c) => `+${c.currentRef}:${CHANGE_REF_PREFIX}${c.number}`);
}
