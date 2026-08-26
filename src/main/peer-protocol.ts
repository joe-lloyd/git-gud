import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";

// Wire protocol + pure helpers for Git Gud peer connections. Electron-free so
// it unit-tests without a display and can be reasoned about in one place.
//
// Transport is HTTP/1.1 JSON over TLS on the LAN. Every host has a
// self-signed certificate (peer-tls.ts); clients learn it on first contact
// and pin it at pairing — afterwards the pinned cert is the only trusted CA
// for that peer and its SHA-256 fingerprint must match on every connection.
// The pairing proof is an HMAC of the host's fingerprint keyed by the code,
// so the code never travels and a man-in-the-middle presenting its own cert
// cannot complete a pairing.
//
//   GET  /gitgud/info            → PeerInfo                     (no auth)
//   POST /gitgud/pair            → { token }                    (pairing code)
//   POST /gitgud/rpc             → RpcResponse                  (bearer token)
//   GET  /gitgud/events?repos=…  → text/event-stream            (bearer token)
// Discovery is a UDP broadcast beacon on DISCOVERY_PORT.

export const PROTOCOL_VERSION = 1;
export const DEFAULT_SERVER_PORT = 47831;
export const DISCOVERY_PORT = 47832;
export const PORT_SEARCH_SPAN = 10; // try DEFAULT..DEFAULT+10 when busy
export const BEACON_INTERVAL_MS = 3_000;
export const BEACON_TTL_MS = 10_000;
export const RPC_TIMEOUT_MS = 60_000; // pull/push can legitimately take a while
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
export const PAIR_MAX_ATTEMPTS = 5;
export const PAIR_WINDOW_MS = 60_000;
export const PAIR_LOCKOUT_MS = 60_000;

export const PEER_URI_SCHEME = "gitgud-peer://";

// ── Types ───────────────────────────────────────────────────────────────

export type PeerInfo = {
  peerId: string;
  name: string;
  version: string;
  platform: string;
  protocol: number;
  // SHA-256 fingerprint of the host's TLS certificate (AA:BB:…). Shown to
  // the user on both sides during pairing.
  fingerprint: string;
};

// `proof` = pairingProof(code, hostFingerprint) — see below.
export type PairRequest = { proof: string; peerId: string; name: string };
export type PairResponse = { ok: true; token: string; peer: PeerInfo } | { ok: false; error: string };

export type RpcRequest = { id: string; repoPath: string; method: string; args: unknown[] };
export type RpcResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string; code?: RpcErrorCode };
export type RpcErrorCode = "unauthorized" | "forbidden-method" | "forbidden-repo" | "read-only" | "not-found" | "failed";

// A repo the host is willing to serve: its open tabs + recent projects.
export type PeerRepoSummary = { path: string; name: string; open: boolean };

export type PeerEvent =
  | { type: "repo-changed"; repoPath: string }
  | { type: "gitignore-changed"; repoPath: string }
  | { type: "activity"; record: unknown }
  | { type: "ping" };

export type Beacon = {
  t: "gitgud-peer";
  v: number;
  peerId: string;
  name: string;
  port: number;
  version: string;
};

// ── Method access ───────────────────────────────────────────────────────
// Reads are always served. The sync set runs on the host unless the share is
// read-only. Anything else never reaches git.

export const READ_METHODS: ReadonlySet<string> = new Set([
  "isRepo",
  "getLog",
  "getOtherRefNamespaces",
  "getBranches",
  "getTags",
  "getStashes",
  "getStatus",
  "getRemotes",
  "getCommitDiff",
  "getCommitFiles",
  "getFileDiff",
  "getCommitFileDiff",
  "getFileDiffSources",
  "getCommitFileDiffSources",
  "getWorktrees",
  "getReflog",
  "getConfig",
  "getCommitMessage",
  "getHeadAuthor",
  "logPickaxe",
  "rangeStat",
  "getConflictFile",
  "getConflictState",
  "rerereStatus",
  "cleanPreview",
  "formatPatch",
  "buildWorkingPatch",
  "isBisecting",
]);

export const SYNC_METHODS: ReadonlySet<string> = new Set([
  "fetch",
  "pull",
  "push",
  "fastForwardBranch",
  "checkout",
  "checkoutAutostash",
  "createBranch",
  "stashSave",
  "stashPop",
  "stashApply",
  "pushTag",
]);

// GitService methods whose IPC handler returns the promise straight through
// (no try/catch). For these the client proxy must resolve with a
// `{ success:false, error }` object instead of throwing, or the renderer's
// invoke() would reject.
export const RESULT_SHAPED_METHODS: ReadonlySet<string> = new Set([
  "checkoutAutostash",
  "removeIndexLock",
  "stashBranch",
  "pull",
  "fastForwardBranch",
  "push",
  "mergeCurrentInto",
  "squashCommits",
  "dropCommits",
  "cherryPickMany",
  "revertMany",
  "runDragAction",
  "rebaseTo",
  "rebaseContinue",
  "rebaseAbort",
  "rebaseSkip",
  "mergeContinue",
  "mergeAbort",
  "addWorktree",
  "removeWorktree",
  "restoreFromReflog",
  "clean",
  "setConfig",
  "rerereForget",
  "setHeadAuthor",
  "pushForReview",
  "syncGerritChangeRefs",
  "commitStreaming",
]);

export type MethodAccess = "read" | "sync" | "denied";

export function methodAccess(method: string): MethodAccess {
  if (READ_METHODS.has(method)) return "read";
  if (SYNC_METHODS.has(method)) return "sync";
  return "denied";
}

export function refusalMessage(method: string, readOnly: boolean): string {
  if (readOnly && SYNC_METHODS.has(method)) {
    return `"${method}" was refused: this share is read-only on the host.`;
  }
  return `"${method}" isn't available on a remote repository — run it on the machine that owns the working tree.`;
}

// ── Peer repo URIs ──────────────────────────────────────────────────────
// A remote repo tab's path: gitgud-peer://<peerId>/<absolute path on peer>.
// Windows paths keep their drive form (C:/Users/…) so the last path segment —
// what TabBar/Sidebar show — is still the folder name.

export function makePeerRepoPath(peerId: string, remotePath: string): string {
  const normalized = remotePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${PEER_URI_SCHEME}${peerId}/${normalized}`;
}

export function isPeerRepoPath(path: string | null | undefined): boolean {
  return typeof path === "string" && path.startsWith(PEER_URI_SCHEME);
}

export function parsePeerRepoPath(path: string): { peerId: string; remotePath: string } | null {
  if (!isPeerRepoPath(path)) return null;
  const rest = path.slice(PEER_URI_SCHEME.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const peerId = rest.slice(0, slash);
  let remotePath = rest.slice(slash + 1);
  if (!remotePath) return null;
  // Drive-letter paths were stored as `C:/…`; POSIX paths lost their leading
  // slash in makePeerRepoPath and get it back here.
  if (!/^[A-Za-z]:\//.test(remotePath)) remotePath = "/" + remotePath;
  return { peerId, remotePath };
}

// ── Pairing / tokens ────────────────────────────────────────────────────

export function generatePairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function generatePeerId(): string {
  return randomBytes(16).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// Binds a pairing attempt to the certificate the client actually connected
// to: HMAC-SHA256(key = pairing code, message = cert fingerprint). The host
// recomputes it with its own code + fingerprint; a MITM with a different
// cert cannot produce a matching proof even if it captured the code.
export function pairingProof(code: string, fingerprint: string): string {
  return createHmac("sha256", code).update(fingerprint.toUpperCase(), "utf8").digest("hex");
}

// Constant-time string compare — pairing codes and token hashes.
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Sliding-window brute-force guard for the pairing endpoint.
export class PairRateLimiter {
  private attempts: number[] = [];
  private lockedUntil = 0;
  constructor(
    private max = PAIR_MAX_ATTEMPTS,
    private windowMs = PAIR_WINDOW_MS,
    private lockoutMs = PAIR_LOCKOUT_MS,
  ) {}

  isLocked(now = Date.now()): boolean {
    return now < this.lockedUntil;
  }

  recordFailure(now = Date.now()): void {
    this.attempts = this.attempts.filter((t) => now - t < this.windowMs);
    this.attempts.push(now);
    if (this.attempts.length >= this.max) {
      this.lockedUntil = now + this.lockoutMs;
      this.attempts = [];
    }
  }

  reset(): void {
    this.attempts = [];
    this.lockedUntil = 0;
  }
}

// ── Discovery beacon ────────────────────────────────────────────────────

export function encodeBeacon(b: Omit<Beacon, "t" | "v">): Buffer {
  const beacon: Beacon = { t: "gitgud-peer", v: PROTOCOL_VERSION, ...b };
  return Buffer.from(JSON.stringify(beacon), "utf8");
}

export function parseBeacon(buf: Buffer | string): Beacon | null {
  try {
    const j = JSON.parse(typeof buf === "string" ? buf : buf.toString("utf8"));
    if (!j || j.t !== "gitgud-peer" || typeof j.v !== "number") return null;
    if (typeof j.peerId !== "string" || !/^[0-9a-f]{8,64}$/.test(j.peerId)) return null;
    if (typeof j.name !== "string" || typeof j.port !== "number") return null;
    if (!Number.isInteger(j.port) || j.port < 1 || j.port > 65535) return null;
    return {
      t: "gitgud-peer",
      v: j.v,
      peerId: j.peerId,
      name: String(j.name).slice(0, 64),
      port: j.port,
      version: typeof j.version === "string" ? j.version : "",
    };
  } catch {
    return null;
  }
}

// ── Server-Sent Events ──────────────────────────────────────────────────

export function encodeSseEvent(ev: PeerEvent): string {
  return `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
}

// Incremental SSE parser — feed chunks, get complete events. Only the `data:`
// field matters (the JSON payload carries `type`); `event:` is informational.
export class SseParser {
  private buf = "";
  feed(chunk: string): PeerEvent[] {
    this.buf += chunk.replace(/\r\n/g, "\n");
    const out: PeerEvent[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf("\n\n")) !== -1) {
      const block = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        const ev = JSON.parse(data);
        if (ev && typeof ev.type === "string") out.push(ev as PeerEvent);
      } catch {
        // malformed frame — skip
      }
    }
    return out;
  }
}

// ── Misc ────────────────────────────────────────────────────────────────

// "host", "host:port", "[v6]:port" → { host, port }
export function parseHostPort(input: string, defaultPort = DEFAULT_SERVER_PORT): { host: string; port: number } | null {
  const s = input.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!s) return null;
  const v6 = s.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) {
    const port = v6[2] ? Number(v6[2]) : defaultPort;
    return validPort(port) ? { host: v6[1], port } : null;
  }
  const parts = s.split(":");
  if (parts.length === 1) return { host: parts[0], port: defaultPort };
  if (parts.length === 2) {
    const port = Number(parts[1]);
    return parts[0] && validPort(port) ? { host: parts[0], port } : null;
  }
  return null;
}

function validPort(p: number): boolean {
  return Number.isInteger(p) && p >= 1 && p <= 65535;
}

// Activity classification for RPC calls the client mirrors into its console.
export function rpcActivityKind(method: string): "read" | "write" {
  return READ_METHODS.has(method) ? "read" : "write";
}
