import * as http from "http";
import { EventEmitter } from "events";
import {
  RESULT_SHAPED_METHODS,
  RPC_TIMEOUT_MS,
  SseParser,
  makePeerRepoPath,
  rpcActivityKind,
  type PairResponse,
  type PeerEvent,
  type PeerInfo,
  type PeerRepoSummary,
  type RpcErrorCode,
  type RpcResponse,
} from "./peer-protocol";
import type { GitActivity } from "./git-service";

// Client side of a peer connection. `PeerConnection` speaks the HTTP/SSE
// protocol to one host; `createRemoteRepoProxy` wraps a connection + remote
// path in an object that quacks like GitService so main's IPC handlers work on
// remote repos without knowing.

export type PeerStatus = "connected" | "connecting" | "offline" | "revoked";

export type PeerEndpoint = { peerId: string; name: string; host: string; port: number; token: string };

export class PeerRpcError extends Error {
  constructor(message: string, public code: RpcErrorCode | "network" | "timeout") {
    super(message);
    this.name = "PeerRpcError";
  }
}

const PROBE_TIMEOUT_MS = 4_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export class PeerConnection extends EventEmitter {
  status: PeerStatus = "offline";
  lastError = "";
  info: PeerInfo | null = null;

  private stream: http.ClientRequest | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private backoff = BACKOFF_MIN_MS;
  private subscriptions: string[] = [];
  private wantConnected = false;
  private seq = 0;

  constructor(public endpoint: PeerEndpoint, private self: { peerId: string; name: string }) {
    super();
  }

  // ── Static: pre-pairing calls ───────────────────────────────────────

  static async probe(host: string, port: number): Promise<PeerInfo> {
    const res = await fetchWithTimeout(`http://${fmtHost(host)}:${port}/gitgud/info`, {}, PROBE_TIMEOUT_MS);
    if (!res.ok) throw new Error(`Peer answered ${res.status}`);
    const info = (await res.json()) as PeerInfo;
    if (!info || typeof info.peerId !== "string") throw new Error("Not a Git Gud peer");
    return info;
  }

  static async pair(host: string, port: number, code: string, self: { peerId: string; name: string }): Promise<{ token: string; peer: PeerInfo }> {
    const res = await fetchWithTimeout(
      `http://${fmtHost(host)}:${port}/gitgud/pair`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, peerId: self.peerId, name: self.name }),
      },
      PROBE_TIMEOUT_MS,
    );
    const body = (await res.json().catch(() => null)) as PairResponse | null;
    if (!body) throw new Error(`Pairing failed (${res.status})`);
    if (!body.ok) throw new Error(body.error);
    return { token: body.token, peer: body.peer };
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  connect(): void {
    this.wantConnected = true;
    if (this.stream || this.retryTimer) return;
    this.openStream();
  }

  disconnect(): void {
    this.wantConnected = false;
    this.closeStream();
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.setStatus("offline", "");
  }

  updateEndpoint(patch: Partial<Pick<PeerEndpoint, "host" | "port" | "name">>): void {
    const changed = (patch.host && patch.host !== this.endpoint.host) || (patch.port && patch.port !== this.endpoint.port);
    Object.assign(this.endpoint, patch);
    // New address → reconnect right away instead of waiting out the backoff.
    if (changed && this.wantConnected) {
      this.backoff = BACKOFF_MIN_MS;
      this.closeStream();
      if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
      this.openStream();
    }
  }

  // Which of the host's repos we want change/activity events for. Re-opens
  // the stream — the query string *is* the subscription.
  setSubscriptions(repoPaths: string[]): void {
    const next = [...new Set(repoPaths)].sort();
    if (next.join("\0") === this.subscriptions.join("\0")) return;
    this.subscriptions = next;
    if (this.wantConnected && (this.status === "connected" || this.stream)) {
      this.closeStream();
      this.openStream();
    }
  }

  // ── RPC ─────────────────────────────────────────────────────────────

  async rpc<T = unknown>(repoPath: string, method: string, args: unknown[] = []): Promise<T> {
    const id = `${Date.now()}-${++this.seq}`;
    let res: Response;
    try {
      res = await fetchWithTimeout(
        this.url("/gitgud/rpc"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.endpoint.token}` },
          body: JSON.stringify({ id, repoPath, method, args }),
        },
        RPC_TIMEOUT_MS + 5_000,
      );
    } catch (e) {
      const timeout = e instanceof Error && e.name === "AbortError";
      throw new PeerRpcError(
        timeout ? `${this.endpoint.name} did not answer "${method}" in time` : `${this.endpoint.name} is unreachable`,
        timeout ? "timeout" : "network",
      );
    }
    const body = (await res.json().catch(() => null)) as RpcResponse | null;
    if (res.status === 401) {
      this.setStatus("revoked", "Access revoked on the host — pair again.");
      throw new PeerRpcError("Access to this peer was revoked. Pair again from the host.", "unauthorized");
    }
    if (!body) throw new PeerRpcError(`Bad response from ${this.endpoint.name} (${res.status})`, "failed");
    if (!body.ok) throw new PeerRpcError(body.error, body.code ?? "failed");
    return body.result as T;
  }

  listRepos(): Promise<PeerRepoSummary[]> {
    return this.rpc<PeerRepoSummary[]>("", "__listRepos");
  }

  // ── SSE stream ──────────────────────────────────────────────────────

  private openStream(): void {
    if (!this.wantConnected) return;
    this.setStatus(this.status === "connected" ? "connected" : "connecting", "");
    const repos = this.subscriptions.map(encodeURIComponent).join(",");
    const req = http.request(
      {
        host: this.endpoint.host,
        port: this.endpoint.port,
        path: `/gitgud/events?repos=${repos}`,
        method: "GET",
        headers: { Authorization: `Bearer ${this.endpoint.token}`, Accept: "text/event-stream" },
        timeout: PROBE_TIMEOUT_MS,
      },
      (res) => {
        req.setTimeout(0);
        if (res.statusCode === 401) {
          res.resume();
          this.closeStream();
          this.setStatus("revoked", "Access revoked on the host — pair again.");
          return; // no retry: only a re-pair fixes this
        }
        if (res.statusCode !== 200) {
          res.resume();
          this.streamFailed(`Peer answered ${res.statusCode}`);
          return;
        }
        this.backoff = BACKOFF_MIN_MS;
        this.setStatus("connected", "");
        const parser = new SseParser();
        res.setEncoding("utf8");
        // If the host stops pinging we treat the stream as dead.
        let idle = this.armIdle(res);
        res.on("data", (chunk: string) => {
          clearTimeout(idle);
          idle = this.armIdle(res);
          for (const ev of parser.feed(chunk)) {
            if (ev.type !== "ping") this.emit("event", ev as PeerEvent);
          }
        });
        res.on("end", () => { clearTimeout(idle); this.streamFailed("Connection closed"); });
        res.on("error", (e) => { clearTimeout(idle); this.streamFailed(String(e.message ?? e)); });
      },
    );
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", (e) => this.streamFailed(e.message));
    req.end();
    this.stream = req;
  }

  private armIdle(res: http.IncomingMessage): NodeJS.Timeout {
    return setTimeout(() => res.destroy(new Error("Peer stopped responding")), 40_000);
  }

  private closeStream(): void {
    const s = this.stream;
    this.stream = null;
    if (s) { try { s.destroy(); } catch { /* ignore */ } }
  }

  private streamFailed(reason: string): void {
    if (!this.stream) return; // already closed on purpose
    this.stream = null;
    if (!this.wantConnected) return;
    this.setStatus("offline", reason);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.openStream();
    }, this.backoff);
    this.backoff = Math.min(BACKOFF_MAX_MS, this.backoff * 2);
  }

  private setStatus(s: PeerStatus, err: string): void {
    if (s === this.status && err === this.lastError) return;
    this.status = s;
    this.lastError = err;
    this.emit("status", s);
  }

  private url(path: string): string {
    return `http://${fmtHost(this.endpoint.host)}:${this.endpoint.port}${path}`;
  }
}

// ── Remote repo proxy ───────────────────────────────────────────────────
// Any method call becomes an RPC. The handful of results that carry host
// paths are rewritten to peer URIs; refusals are shaped to what each IPC
// handler expects (thrown vs `{ success:false }`).

export type RemoteRepoProxyOpts = {
  connection: PeerConnection;
  remotePath: string; // absolute path on the host
  peerRepoPath: string; // gitgud-peer:// URI used as the tab path here
  onActivity?: (rec: GitActivity) => void;
};

let activitySeq = 0;

export function createRemoteRepoProxy(opts: RemoteRepoProxyOpts): object {
  const { connection, remotePath, peerRepoPath, onActivity } = opts;
  const peerId = connection.endpoint.peerId;

  const call = async (method: string, args: unknown[]): Promise<unknown> => {
    const start = Date.now();
    const kind = rpcActivityKind(method);
    let result: unknown;
    let failed = false;
    let output = "";
    try {
      result = await connection.rpc(remotePath, method, args);
      if (method === "getWorktrees" && Array.isArray(result)) {
        result = result.map((w) => (w && typeof w.path === "string" ? { ...w, path: makePeerRepoPath(peerId, w.path) } : w));
      }
      if (kind === "write") output = summarize(result);
      const shaped = result as { success?: unknown; error?: unknown } | null;
      if (shaped && typeof shaped === "object" && shaped.success === false) {
        failed = true;
        output = String(shaped.error ?? output);
      }
      return result;
    } catch (e) {
      failed = true;
      const msg = e instanceof Error ? e.message : String(e);
      output = msg;
      if (RESULT_SHAPED_METHODS.has(method)) return { success: false, error: msg };
      throw new Error(msg);
    } finally {
      if (onActivity && !(method === "isRepo")) {
        onActivity({
          id: `peer-${Date.now()}-${activitySeq++}`,
          repoPath: peerRepoPath,
          args: [`@${connection.endpoint.name}`, method, ...args.map(argLabel)],
          output,
          failed,
          kind,
          durationMs: Date.now() - start,
          ts: start,
        });
      }
    }
  };

  const target: Record<string, unknown> = {
    getRepoPath: () => peerRepoPath,
    __isRemoteProxy: true,
    __peerId: peerId,
    __remotePath: remotePath,
  };

  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop as string];
      if (typeof prop !== "string" || prop === "then" || prop === "toJSON") return undefined;
      // Private field reach-ins like svc['git'] have no remote counterpart.
      if (prop === "git") return undefined;
      return (...args: unknown[]) => call(prop, args);
    },
    has(t, prop) {
      return typeof prop === "string" && (prop in t || prop !== "git");
    },
  });
}

export function isRemoteProxy(svc: unknown): svc is { __peerId: string; __remotePath: string } {
  return !!svc && typeof svc === "object" && (svc as { __isRemoteProxy?: boolean }).__isRemoteProxy === true;
}

function summarize(v: unknown): string {
  if (v === null || v === undefined) return "ok";
  if (typeof v === "string") return v.length > 2_000 ? v.slice(0, 2_000) + "…" : v;
  try {
    const s = JSON.stringify(v);
    return s.length > 2_000 ? s.slice(0, 2_000) + "…" : s;
  } catch {
    return String(v);
  }
}

function argLabel(a: unknown): string {
  if (typeof a === "string") return a.length > 80 ? a.slice(0, 77) + "…" : a;
  if (typeof a === "number" || typeof a === "boolean") return String(a);
  if (a === null || a === undefined) return "";
  try { return JSON.stringify(a).slice(0, 80); } catch { return "[object]"; }
}

function fmtHost(h: string): string {
  return h.includes(":") && !h.startsWith("[") ? `[${h}]` : h;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
