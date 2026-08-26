import * as https from "https";
import * as tls from "tls";
import { EventEmitter } from "events";
import {
  RESULT_SHAPED_METHODS,
  RPC_TIMEOUT_MS,
  SseParser,
  makePeerRepoPath,
  pairingProof,
  rpcActivityKind,
  type PairRequest,
  type PairResponse,
  type PeerDeviceKind,
  type PeerEvent,
  type PeerInfo,
  type PeerRepoSummary,
  type RpcErrorCode,
  type RpcResponse,
} from "./peer-protocol";
import { certFingerprint } from "./peer-tls";
import type { GitActivity } from "./git-service";

// Client side of a peer connection. `PeerConnection` speaks the HTTPS/SSE
// protocol to one host; `createRemoteRepoProxy` wraps a connection + remote
// path in an object that quacks like GitService so main's IPC handlers work on
// remote repos without knowing.
//
// TLS model: the host's self-signed certificate is learned on first contact
// (probe), pinned at pairing, and from then on is the ONLY CA we trust for
// that peer — plus an explicit fingerprint check on every handshake. Nothing
// here ever trusts the system CA store.

export type PeerStatus = "connected" | "connecting" | "offline" | "revoked";

export type PeerEndpoint = { peerId: string; name: string; host: string; port: number; token: string; certPem: string };

export class PeerRpcError extends Error {
  constructor(message: string, public code: RpcErrorCode | "network" | "timeout" | "tls") {
    super(message);
    this.name = "PeerRpcError";
  }
}

const PROBE_TIMEOUT_MS = 4_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

// ── Transport ───────────────────────────────────────────────────────────

type HttpResult = { status: number; body: string; certPem: string; fingerprint: string };

// Pin options: the pinned cert is the sole CA and its fingerprint must match.
function pinOptions(certPem: string): Pick<https.RequestOptions, "ca" | "checkServerIdentity" | "rejectUnauthorized"> {
  const expected = certFingerprint(certPem);
  return {
    ca: certPem,
    rejectUnauthorized: true,
    checkServerIdentity: (_host: string, cert: tls.PeerCertificate) =>
      cert.fingerprint256 === expected ? undefined : new Error(`Peer certificate changed (expected ${expected.slice(0, 23)}…)`),
  };
}

// First-contact options: accept any cert, but report it so the caller can
// pin it. Only ever used for /info and the pairing request itself.
const TOFU_OPTIONS: Pick<https.RequestOptions, "rejectUnauthorized"> = { rejectUnauthorized: false };

function request(
  opts: https.RequestOptions & { body?: string; timeoutMs: number },
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const { body, timeoutMs, ...rest } = opts;
    const req = https.request(
      {
        ...rest,
        // agent: false → no TLS session resumption. Node skips
        // checkServerIdentity on resumed sessions; we want the pin checked on
        // every connection.
        agent: false,
        minVersion: "TLSv1.2",
        headers: { ...(rest.headers ?? {}), ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}) },
      },
      (res) => {
        const sock = res.socket as tls.TLSSocket;
        const cert = sock.getPeerCertificate?.();
        const certPem = cert?.raw ? derToPem(cert.raw) : "";
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (d: string) => { data += d; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data, certPem, fingerprint: cert?.fingerprint256 ?? "" }));
        res.on("error", reject);
      },
    );
    const t = setTimeout(() => req.destroy(Object.assign(new Error("timeout"), { name: "AbortError" })), timeoutMs);
    req.on("error", (e) => { clearTimeout(t); reject(e); });
    req.on("close", () => clearTimeout(t));
    if (body) req.write(body);
    req.end();
  });
}

function derToPem(der: Buffer): string {
  return `-----BEGIN CERTIFICATE-----\n${der.toString("base64").replace(/(.{64})/g, "$1\n").trimEnd()}\n-----END CERTIFICATE-----\n`;
}

function isTlsError(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? "";
  return /CERT|TLS|SSL|EPROTO|certificate/i.test(code) || /certificate|pin|TLS|SSL/i.test(String((e as Error)?.message ?? ""));
}

export class PeerConnection extends EventEmitter {
  status: PeerStatus = "offline";
  lastError = "";
  info: PeerInfo | null = null;

  private stream: https.ClientRequest | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private backoff = BACKOFF_MIN_MS;
  private subscriptions: string[] = [];
  private wantConnected = false;
  private seq = 0;

  constructor(public endpoint: PeerEndpoint, private self: { peerId: string; name: string }) {
    super();
  }

  // ── Static: pre-pairing calls ───────────────────────────────────────

  // Trust-on-first-use: returns the host's info AND the certificate it
  // presented, so the UI can show the fingerprint and pairing can pin it.
  static async probe(host: string, port: number): Promise<{ info: PeerInfo; certPem: string }> {
    const r = await request({ host, port, path: "/gitgud/info", method: "GET", ...TOFU_OPTIONS, timeoutMs: PROBE_TIMEOUT_MS });
    if (r.status !== 200) throw new Error(`Peer answered ${r.status}`);
    const info = JSON.parse(r.body) as PeerInfo;
    if (!info || typeof info.peerId !== "string") throw new Error("Not a Git Gud peer");
    if (!r.certPem) throw new Error("Peer did not present a certificate");
    // The host's self-reported fingerprint must be the cert we actually saw —
    // otherwise something between us is terminating TLS.
    if (info.fingerprint && info.fingerprint !== r.fingerprint) {
      throw new Error("Certificate mismatch: the connection is not going directly to that peer.");
    }
    return { info, certPem: r.certPem };
  }

  // Pair against the certificate learned by probe(): the connection is pinned
  // to it and the proof binds the code to its fingerprint.
  static async pair(
    host: string, port: number, code: string, self: { peerId: string; name: string }, certPem: string,
    kind: PeerDeviceKind = "desktop",
  ): Promise<{ token: string; peer: PeerInfo; readOnly: boolean }> {
    const fingerprint = certFingerprint(certPem);
    const r = await request({
      host, port, path: "/gitgud/pair", method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proof: pairingProof(code, fingerprint), peerId: self.peerId, name: self.name, kind } satisfies PairRequest),
      ...pinOptions(certPem),
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    let body: PairResponse | null = null;
    try { body = JSON.parse(r.body) as PairResponse; } catch { /* below */ }
    if (!body) throw new Error(`Pairing failed (${r.status})`);
    if (!body.ok) throw new Error(body.error);
    return { token: body.token, peer: body.peer, readOnly: body.readOnly === true };
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
    let r: HttpResult;
    try {
      r = await request({
        host: this.endpoint.host, port: this.endpoint.port, path: "/gitgud/rpc", method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.endpoint.token}` },
        body: JSON.stringify({ id, repoPath, method, args }),
        ...pinOptions(this.endpoint.certPem),
        timeoutMs: RPC_TIMEOUT_MS + 5_000,
      });
    } catch (e) {
      const timeout = e instanceof Error && e.name === "AbortError";
      if (!timeout && isTlsError(e)) {
        this.setStatus("offline", "TLS certificate check failed — the peer's identity changed.");
        throw new PeerRpcError(`${this.endpoint.name}: certificate check failed. If you reinstalled Git Gud there, forget this peer and pair again.`, "tls");
      }
      throw new PeerRpcError(
        timeout ? `${this.endpoint.name} did not answer "${method}" in time` : `${this.endpoint.name} is unreachable`,
        timeout ? "timeout" : "network",
      );
    }
    let body: RpcResponse | null = null;
    try { body = JSON.parse(r.body) as RpcResponse; } catch { /* below */ }
    if (r.status === 401) {
      this.setStatus("revoked", "Access revoked on the host — pair again.");
      throw new PeerRpcError("Access to this peer was revoked. Pair again from the host.", "unauthorized");
    }
    if (!body) throw new PeerRpcError(`Bad response from ${this.endpoint.name} (${r.status})`, "failed");
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
    const req = https.request(
      {
        host: this.endpoint.host,
        port: this.endpoint.port,
        path: `/gitgud/events?repos=${repos}`,
        method: "GET",
        headers: { Authorization: `Bearer ${this.endpoint.token}`, Accept: "text/event-stream" },
        timeout: PROBE_TIMEOUT_MS,
        agent: false,
        minVersion: "TLSv1.2",
        ...pinOptions(this.endpoint.certPem),
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
    req.on("error", (e) => this.streamFailed(isTlsError(e) ? "TLS certificate check failed — the peer's identity changed" : e.message));
    req.end();
    this.stream = req;
  }

  private armIdle(res: NodeJS.ReadableStream & { destroy: (e?: Error) => void }): NodeJS.Timeout {
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
