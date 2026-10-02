// Forgejo (and Gitea) REST provider. Node `https` with an explicit CA so a
// homelab forge behind a private CA (Caddy's local authority) verifies
// without touching process-wide trust — Node's fetch rejects such chains even
// with --use-system-ca.
import * as https from "https";
import { URL } from "url";
import type { PullCommit, PullReviewSummary, StatusCheck, StatusState } from "../peer-protocol";
import { ForgeRequestError, type ForgeProvider, type ProviderComment, type ProviderPull, type ProviderPullRef } from "./provider";

export type ForgejoOptions = {
  id: string;
  url: string; // https://git.home.arpa
  token: string;
  ca?: string; // PEM; omitted → Node's default roots
  timeoutMs?: number;
};

const PAGE = 50; // Forgejo's default MAX_RESPONSE_ITEMS
const MAX_PAGES = 5;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_DIFF_BYTES = 64 * 1024 * 1024;
const STATES = new Set<StatusState>(["pending", "success", "error", "failure", "warning", "skipped"]);
const TLS_CODES = new Set([
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_GET_ISSUER_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_UNTRUSTED",
]);

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export class ForgejoProvider implements ForgeProvider {
  readonly kind = "forgejo";
  readonly id: string;
  readonly url: string;
  private agent: https.Agent;
  private token: string;
  private timeoutMs: number;

  constructor(o: ForgejoOptions) {
    this.id = o.id;
    this.url = o.url.replace(/\/+$/, "");
    this.token = o.token;
    this.timeoutMs = o.timeoutMs ?? 15_000;
    this.agent = new https.Agent({ keepAlive: true, maxSockets: 8, ...(o.ca ? { ca: o.ca } : {}) });
  }

  // ── HTTP ──────────────────────────────────────────────────────────────

  private request(path: string, accept: "json" | "text"): Promise<string> {
    const url = new URL(`${this.url}/api/v1${path}`);
    const max = accept === "json" ? MAX_JSON_BYTES : MAX_DIFF_BYTES;
    const where = `${url.pathname.replace(/^\/api\/v1/, "")}`;
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method: "GET",
        agent: this.agent,
        headers: { Authorization: `token ${this.token}`, Accept: accept === "json" ? "application/json" : "text/plain" },
      }, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > max) { req.destroy(new ForgeRequestError(`Forgejo response for ${where} is larger than ${Math.round(max / 1048576)} MB`)); return; }
          chunks.push(c);
        });
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) return resolve(body);
          reject(new ForgeRequestError(httpMessage(status, where, body), status));
        });
        res.on("error", reject);
      });
      req.setTimeout(this.timeoutMs, () => req.destroy(new ForgeRequestError(`Forgejo did not answer ${where} within ${this.timeoutMs / 1000}s`)));
      req.on("error", (e: NodeJS.ErrnoException) => {
        if (e instanceof ForgeRequestError) return reject(e);
        const code = e.code ?? "";
        if (TLS_CODES.has(code)) return reject(new ForgeRequestError(`TLS: ${code} talking to ${url.host} — set the forge's caFile to the CA that signed it`));
        if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EHOSTUNREACH" || code === "ECONNRESET" || code === "ETIMEDOUT") {
          return reject(new ForgeRequestError(`Can't reach ${url.host} (${code})`));
        }
        reject(new ForgeRequestError(`Forgejo request failed: ${e.message}`));
      });
      req.end();
    });
  }

  private async json(path: string): Promise<Json> {
    const body = await this.request(path, "json");
    try { return JSON.parse(body); } catch { throw new ForgeRequestError(`Forgejo sent invalid JSON for ${path.split("?")[0]}`); }
  }

  private async pages(path: string): Promise<Json[]> {
    const out: Json[] = [];
    const sep = path.includes("?") ? "&" : "?";
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await this.json(`${path}${sep}limit=${PAGE}&page=${page}`);
      if (!Array.isArray(batch)) throw new ForgeRequestError(`Forgejo sent an unexpected shape for ${path.split("?")[0]}`);
      out.push(...batch);
      if (batch.length < PAGE) break;
    }
    return out;
  }

  // ── ForgeProvider ─────────────────────────────────────────────────────

  async whoami(): Promise<string> {
    const u = await this.json("/user");
    if (typeof u?.login !== "string") throw new ForgeRequestError("Forgejo /user did not return a login");
    return u.login;
  }

  async searchOpenPulls(owner?: string): Promise<ProviderPullRef[]> {
    const q = `/repos/issues/search?type=pulls&state=open&sort=recentupdate${owner ? `&owner=${encodeURIComponent(owner)}` : ""}`;
    const issues = await this.pages(q);
    return issues
      .filter((i) => typeof i?.repository?.full_name === "string" && Number.isInteger(i?.number))
      .map((i) => ({ repo: i.repository.full_name as string, number: i.number as number, updatedAt: String(i.updated_at ?? "") }));
  }

  async getPull(repo: string, number: number): Promise<ProviderPull> {
    const p = await this.json(`${repoPath(repo)}/pulls/${number}`);
    return {
      repo,
      number,
      state: p.state === "closed" ? "closed" : "open",
      title: String(p.title ?? ""),
      body: String(p.body ?? ""),
      author: String(p.user?.login ?? ""),
      draft: p.draft === true,
      createdAt: String(p.created_at ?? ""),
      updatedAt: String(p.updated_at ?? ""),
      headSha: String(p.head?.sha ?? ""),
      base: String(p.base?.ref ?? ""),
      head: String(p.head?.ref ?? p.head?.label ?? ""),
      add: num(p.additions),
      del: num(p.deletions),
      files: num(p.changed_files),
      comments: num(p.comments) + num(p.review_comments),
      mergeable: typeof p.mergeable === "boolean" ? p.mergeable : null,
      url: String(p.html_url ?? ""),
      requestedReviewers: Array.isArray(p.requested_reviewers) ? p.requested_reviewers.map((r: Json) => String(r?.login ?? "")).filter(Boolean) : [],
    };
  }

  async getStatuses(repo: string, sha: string): Promise<StatusCheck[]> {
    const c = await this.json(`${repoPath(repo)}/commits/${encodeURIComponent(sha)}/status`);
    const list: Json[] = Array.isArray(c?.statuses) ? c.statuses : [];
    return list
      .filter((s) => typeof s?.context === "string")
      .map((s) => ({
        context: s.context as string,
        state: (STATES.has(s.status) ? s.status : "pending") as StatusState,
        description: String(s.description ?? ""),
        ...(s.target_url ? { url: String(s.target_url) } : {}),
      }));
  }

  async getReviews(repo: string, number: number): Promise<PullReviewSummary[]> {
    const list = await this.pages(`${repoPath(repo)}/pulls/${number}/reviews`);
    return list
      .filter((r) => r && r.dismissed !== true && r.state !== "PENDING" && r.state !== "REQUEST_REVIEW")
      .map((r) => ({
        user: String(r.user?.login ?? ""),
        state: String(r.state ?? ""),
        submittedAt: String(r.submitted_at ?? ""),
        commitId: String(r.commit_id ?? ""),
        body: String(r.body ?? ""),
        stale: r.stale === true,
      }));
  }

  async getComments(repo: string, number: number): Promise<ProviderComment[]> {
    // No pagination parameters on this endpoint — it returns every comment.
    const list = await this.json(`${repoPath(repo)}/issues/${number}/comments`);
    if (!Array.isArray(list)) return [];
    return list.map((c: Json) => ({ user: String(c?.user?.login ?? ""), body: String(c?.body ?? ""), url: String(c?.html_url ?? "") }));
  }

  getDiff(repo: string, number: number): Promise<string> {
    return this.request(`${repoPath(repo)}/pulls/${number}.diff?binary=false`, "text");
  }

  async getCommits(repo: string, number: number): Promise<PullCommit[]> {
    const list = await this.pages(`${repoPath(repo)}/pulls/${number}/commits?files=false&verification=false`);
    return list.map((c) => ({
      sha: String(c.sha ?? ""),
      subject: String(c.commit?.message ?? "").split("\n")[0],
      author: String(c.author?.login || c.commit?.author?.name || ""),
      date: String(c.commit?.author?.date ?? c.created ?? ""),
    }));
  }
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function repoPath(repo: string): string {
  const [owner, name] = repo.split("/");
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

// The token never appears here: only the status, the endpoint and Forgejo's
// own message.
function httpMessage(status: number, where: string, body: string): string {
  let msg = "";
  try { const j = JSON.parse(body); if (typeof j?.message === "string") msg = j.message; } catch { msg = body.slice(0, 160); }
  if (status === 401) return `Forgejo rejected the token (401)${msg ? `: ${msg}` : ""} — check the forge's tokenFile`;
  if (status === 403) return `Forgejo refused ${where} (403)${msg ? `: ${msg}` : ""} — the token may lack read:repository / read:issue`;
  if (status === 404) return `Not found on Forgejo: ${where} (404)`;
  return `Forgejo ${status} for ${where}${msg ? `: ${msg}` : ""}`;
}
