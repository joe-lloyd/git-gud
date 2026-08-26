import * as http from "http";
import { URL } from "url";
import {
  MAX_BODY_BYTES,
  PORT_SEARCH_SPAN,
  RPC_TIMEOUT_MS,
  PairRateLimiter,
  encodeSseEvent,
  generatePairingCode,
  generateToken,
  methodAccess,
  refusalMessage,
  safeEqual,
  type PairResponse,
  type PeerEvent,
  type PeerInfo,
  type PeerRepoSummary,
  type RpcErrorCode,
  type RpcRequest,
  type RpcResponse,
} from "./peer-protocol";
import type { PairedDevice } from "./peer-store";

// Host side of a peer connection: a plain Node http server that lets paired
// Git Gud instances read (and, unless read-only, sync) the repos this instance
// already knows about. Everything git-related is delegated back to the app
// through `PeerServerHost` so this file stays free of Electron and GitService.

export interface PeerServerHost {
  info(): PeerInfo;
  readOnly(): boolean;
  listRepos(): PeerRepoSummary[];
  // The GitService for an allowed repo, or null when the path is not on the
  // host's allow-list (open tabs ∪ recent projects) or isn't a repo.
  resolveRepo(repoPath: string): Promise<object | null>;
  // Start watching a repo's .git for a subscriber; returns the stop function.
  watchRepo(repoPath: string, onEvent: (ev: PeerEvent) => void): () => void;
  verifyToken(token: string): PairedDevice | null;
  registerPaired(peerId: string, name: string, token: string): void;
  log?(msg: string): void;
}

type SseClient = { res: http.ServerResponse; repos: Set<string>; device: PairedDevice };

export class PeerServer {
  private server: http.Server | null = null;
  private port = 0;
  private pairingCode = generatePairingCode();
  private limiter = new PairRateLimiter();
  private clients = new Set<SseClient>();

  constructor(private host: PeerServerHost) {}

  get listeningPort(): number {
    return this.port;
  }

  get isListening(): boolean {
    return this.server !== null;
  }

  get code(): string {
    return this.pairingCode;
  }

  regenerateCode(): string {
    this.pairingCode = generatePairingCode();
    this.limiter.reset();
    return this.pairingCode;
  }

  connectedDevices(): PairedDevice[] {
    const seen = new Map<string, PairedDevice>();
    for (const c of this.clients) seen.set(c.device.peerId, c.device);
    return [...seen.values()];
  }

  // Bind `preferred`, falling back to the next PORT_SEARCH_SPAN ports when
  // busy (a second instance on the same machine is the common case).
  async start(preferred: number): Promise<number> {
    if (this.server) return this.port;
    let lastErr: unknown = null;
    for (let p = preferred; p <= preferred + PORT_SEARCH_SPAN; p++) {
      try {
        this.port = await this.listen(p);
        return this.port;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr ?? new Error("No free port for peer server");
  }

  private listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        this.handle(req, res).catch((e) => {
          this.host.log?.(`peer-server: unhandled ${String(e)}`);
          if (!res.headersSent) this.json(res, 500, { ok: false, error: "Internal error" });
          else res.end();
        });
      });
      srv.keepAliveTimeout = 65_000;
      srv.on("error", (e) => reject(e));
      srv.listen(port, "0.0.0.0", () => {
        srv.removeAllListeners("error");
        srv.on("error", (e) => this.host.log?.(`peer-server: ${String(e)}`));
        this.server = srv;
        resolve(port);
      });
    });
  }

  stop(): void {
    for (const c of this.clients) {
      try { c.res.end(); } catch { /* gone */ }
    }
    this.clients.clear();
    const srv = this.server;
    this.server = null;
    this.port = 0;
    if (srv) {
      srv.close();
      // Node keeps idle keep-alive sockets open until they time out —
      // closeAllConnections exists since Node 18.2.
      (srv as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    }
  }

  // Fan an activity record out to every stream subscribed to its repo.
  broadcastActivity(repoPath: string, record: unknown): void {
    if (this.clients.size === 0) return;
    const frame = encodeSseEvent({ type: "activity", record });
    for (const c of this.clients) {
      if (c.repos.has(repoPath)) this.write(c, frame);
    }
  }

  // ── Routing ─────────────────────────────────────────────────────────

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && path === "/gitgud/info") {
      return this.json(res, 200, this.host.info());
    }
    if (req.method === "POST" && path === "/gitgud/pair") {
      return this.handlePair(req, res);
    }

    // Everything below needs a bearer token.
    const device = this.authenticate(req);
    if (!device) {
      return this.json(res, 401, { ok: false, error: "Not paired or access revoked", code: "unauthorized" satisfies RpcErrorCode });
    }

    if (req.method === "POST" && path === "/gitgud/rpc") {
      return this.handleRpc(req, res);
    }
    if (req.method === "GET" && path === "/gitgud/events") {
      return this.handleEvents(url, res, device);
    }
    this.json(res, 404, { ok: false, error: "Not found" });
  }

  private authenticate(req: http.IncomingMessage): PairedDevice | null {
    const h = req.headers.authorization ?? "";
    const m = /^Bearer\s+([0-9a-f]{64})$/i.exec(h);
    if (!m) return null;
    return this.host.verifyToken(m[1]);
  }

  private async handlePair(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (this.limiter.isLocked()) {
      return this.json(res, 429, { ok: false, error: "Too many attempts — pairing is locked for a minute." } satisfies PairResponse);
    }
    const body = await this.readJson(req);
    if (!body) return this.json(res, 400, { ok: false, error: "Bad request" } satisfies PairResponse);
    const code = String((body as { code?: unknown }).code ?? "");
    const peerId = String((body as { peerId?: unknown }).peerId ?? "");
    const name = String((body as { name?: unknown }).name ?? "").trim() || "Unnamed device";
    if (!/^[0-9a-f]{8,64}$/.test(peerId)) {
      return this.json(res, 400, { ok: false, error: "Invalid peer id" } satisfies PairResponse);
    }
    if (!/^\d{6}$/.test(code) || !safeEqual(code, this.pairingCode)) {
      this.limiter.recordFailure();
      this.host.log?.(`peer-server: pairing refused for ${name} (${peerId.slice(0, 8)})`);
      return this.json(res, 401, { ok: false, error: "Wrong pairing code" } satisfies PairResponse);
    }
    const token = generateToken();
    this.host.registerPaired(peerId, name, token);
    // One code, one pairing — rotate so a shoulder-surfed code is useless.
    this.regenerateCode();
    this.host.log?.(`peer-server: paired with ${name}`);
    this.json(res, 200, { ok: true, token, peer: this.host.info() } satisfies PairResponse);
  }

  private async handleRpc(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = (await this.readJson(req)) as Partial<RpcRequest> | null;
    if (!body || typeof body.method !== "string") {
      return this.json(res, 400, { id: String(body?.id ?? ""), ok: false, error: "Bad request", code: "failed" } satisfies RpcResponse);
    }
    const id = String(body.id ?? "");
    const method = body.method;
    const args = Array.isArray(body.args) ? body.args : [];
    const reply = (r: RpcResponse, status = 200) => this.json(res, status, r);

    // Host-level (non-repo) methods.
    if (method === "__listRepos") return reply({ id, ok: true, result: this.host.listRepos() });
    if (method === "__ping") return reply({ id, ok: true, result: { ts: Date.now() } });

    const access = methodAccess(method);
    if (access === "denied") {
      return reply({ id, ok: false, error: refusalMessage(method, false), code: "forbidden-method" }, 403);
    }
    if (access === "sync" && this.host.readOnly()) {
      return reply({ id, ok: false, error: refusalMessage(method, true), code: "read-only" }, 403);
    }

    const repoPath = typeof body.repoPath === "string" ? body.repoPath : "";
    const svc = repoPath ? await this.host.resolveRepo(repoPath) : null;
    if (!svc) {
      return reply({ id, ok: false, error: "Repository is not shared by this peer", code: "forbidden-repo" }, 403);
    }
    const fn = (svc as Record<string, unknown>)[method];
    if (typeof fn !== "function") {
      return reply({ id, ok: false, error: `Unknown method "${method}"`, code: "not-found" }, 404);
    }

    try {
      const result = await withTimeout(
        Promise.resolve((fn as (...a: unknown[]) => unknown).apply(svc, args)),
        RPC_TIMEOUT_MS,
        `"${method}" timed out after ${RPC_TIMEOUT_MS / 1000}s on the host`,
      );
      reply({ id, ok: true, result: result === undefined ? null : result });
    } catch (e) {
      reply({ id, ok: false, error: String(e instanceof Error ? e.message : e), code: "failed" });
    }
  }

  private async handleEvents(url: URL, res: http.ServerResponse, device: PairedDevice): Promise<void> {
    const wanted = (url.searchParams.get("repos") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => { try { return decodeURIComponent(s); } catch { return ""; } })
      .filter(Boolean);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(":ok\n\n");

    const client: SseClient = { res, repos: new Set(), device };
    this.clients.add(client);
    const stops: Array<() => void> = [];

    for (const p of wanted) {
      // Only allow-listed repos get a watcher — resolveRepo enforces the list.
      if (!(await this.host.resolveRepo(p))) continue;
      client.repos.add(p);
      stops.push(this.host.watchRepo(p, (ev) => this.write(client, encodeSseEvent(ev))));
    }

    const ping = setInterval(() => this.write(client, encodeSseEvent({ type: "ping" })), 15_000);
    const cleanup = () => {
      clearInterval(ping);
      for (const s of stops) { try { s(); } catch { /* ignore */ } }
      this.clients.delete(client);
    };
    res.on("close", cleanup);
    res.on("error", cleanup);
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private write(c: SseClient, frame: string): void {
    try {
      if (!c.res.destroyed) c.res.write(frame);
    } catch {
      this.clients.delete(c);
    }
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    const data = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(data),
    });
    res.end(data);
  }

  private readJson(req: http.IncomingMessage): Promise<unknown | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (d: Buffer) => {
        size += d.length;
        if (size > MAX_BODY_BYTES) {
          req.destroy();
          resolve(null);
          return;
        }
        chunks.push(d);
      });
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          resolve(null);
        }
      });
      req.on("error", () => resolve(null));
    });
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
