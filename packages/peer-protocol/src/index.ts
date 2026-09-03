// @gitgud/peer-protocol — the wire protocol shared by the desktop app, the
// headless daemon and the companion phone app. PURE TypeScript: no Node, no
// Electron, no Buffer — anything that needs crypto or sockets lives in the
// consumer (src/main/peer-protocol.ts adds the Node parts).
//
// Transport is HTTP/1.1 JSON over TLS. Every host has a self-signed
// certificate; clients learn it on first contact (or from a QR) and pin it —
// afterwards it is the only trusted CA for that peer and its SHA-256
// fingerprint must match on every connection. The pairing proof is
// HMAC-SHA256(key = code, msg = fingerprint), so the code never travels.
//
//   GET  /gitgud/info            → PeerInfo                     (no auth)
//   POST /gitgud/pair            → PairResponse                 (proof)
//   POST /gitgud/rpc             → RpcResponse                  (bearer token)
//   GET  /gitgud/events?repos=…  → text/event-stream            (bearer token)
// Discovery is a UDP broadcast beacon on DISCOVERY_PORT (LAN only).

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
  // Host-wide read-only switch (additive; absent on v1.12 hosts).
  readOnly?: boolean;
  // M7: how to reach this host from anywhere — `relay://host:port/<peerId>#fp`.
  // Clients store it and fall back to it when direct addresses stop answering.
  relay?: string;
};

// What kind of device is pairing. Hosts default `companion` (phone) devices
// to read-only; `headless` is the Linux daemon acting as a client (M5 relay).
export type PeerDeviceKind = "desktop" | "companion" | "headless";

// `proof` = pairingProof(code, hostFingerprint) — see below.
// Reciprocal pairing (additive): a desktop that initiates pairing can hand
// the host everything the host needs to browse *it* back — a bearer token the
// initiator has pre-registered, its certificate to pin, and how to reach it.
// One pairing ceremony, both directions. Hosts that predate this ignore it.
export type PairReciprocal = { token: string; certPem: string; port: number; name: string; addresses?: string[]; relay?: string };
export type PairRequest = { proof: string; peerId: string; name: string; kind?: PeerDeviceKind; reciprocal?: PairReciprocal };
// `readOnly` tells the new device up front whether writes will be refused
// (per-device flag OR host-wide switch) so UIs can grey out instead of 403.
export type PairResponse = { ok: true; token: string; peer: PeerInfo; readOnly?: boolean } | { ok: false; error: string };

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
// The peer model is "drive the other machine's Git Gud": every GitService
// operation the local UI can trigger runs on the host, against the host's
// working tree. Reads are always served; writes are refused only when the
// share is read-only. Anything not listed (private helpers, `git` reach-ins,
// typos) never reaches the service.

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

// Every mutating GitService method. Kept explicit (rather than "any function
// on the service") so the host's attack surface is a reviewed list.
export const WRITE_METHODS: ReadonlySet<string> = new Set([
  // working tree / index
  "stage", "unstage", "discardChanges", "discardUntracked", "applyPatch", "clean",
  "removeIndexLock", "writeFileContent", "markResolved",
  // commits
  "commit", "commitStreaming", "amendCommit", "setHeadAuthor",
  "revert", "revertMany", "cherryPick", "cherryPickMany", "squashCommits", "dropCommits",
  "reset", "rebaseTo", "restoreFromReflog",
  // rebase / merge state machine
  "rebaseContinue", "rebaseAbort", "rebaseSkip", "mergeContinue", "mergeAbort",
  "operationContinue", "operationAbort", "operationSkip",
  "merge", "mergeCurrentInto", "runDragAction", "autoFix",
  // branches / tags / remotes
  "checkout", "checkoutAutostash", "createBranch", "deleteBranch", "renameBranch", "deleteRemoteBranch",
  "createTag", "deleteTag", "renameTag", "pushTag", "deleteRemoteTag",
  "fetch", "pull", "fastForwardBranch", "push", "pushForReview", "syncGerritChangeRefs", "clearGerritChangeRefs",
  // stashes
  "stashSave", "stashPop", "stashApply", "stashDrop", "stashBranch",
  // worktrees / bisect / config
  "addWorktree", "removeWorktree",
  "bisectStart", "bisectGood", "bisectBad", "bisectReset",
  "setConfig", "rerereForget",
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
  "operationContinue",
  "operationAbort",
  "operationSkip",
  "autoFix",
  "checkout",
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

export type MethodAccess = "read" | "write" | "denied";

export function methodAccess(method: string): MethodAccess {
  if (READ_METHODS.has(method)) return "read";
  if (WRITE_METHODS.has(method)) return "write";
  return "denied";
}

export function refusalMessage(method: string, readOnly: boolean, scope: "host" | "device" = "host"): string {
  if (readOnly && WRITE_METHODS.has(method)) {
    return scope === "device"
      ? `"${method}" was refused: this device is read-only on the host.`
      : `"${method}" was refused: this share is read-only on the host.`;
  }
  return `"${method}" can't be run on a remote repository.`;
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

// ── Pairing rate limit ──────────────────────────────────────────────────
// Sliding-window brute-force guard for the pairing endpoint. Each lockout
// doubles the previous one (60 s → 2 min → … → 1 h) until a success resets.
export const PAIR_LOCKOUT_MAX_MS = 60 * 60_000;
export class PairRateLimiter {
  private attempts: number[] = [];
  private lockedUntil = 0;
  private lockouts = 0;
  constructor(
    private max = PAIR_MAX_ATTEMPTS,
    private windowMs = PAIR_WINDOW_MS,
    private lockoutMs = PAIR_LOCKOUT_MS,
  ) {}

  isLocked(now = Date.now()): boolean {
    return now < this.lockedUntil;
  }

  // Milliseconds until the current lockout ends (0 when not locked).
  lockedFor(now = Date.now()): number {
    return Math.max(0, this.lockedUntil - now);
  }

  recordFailure(now = Date.now()): void {
    this.attempts = this.attempts.filter((t) => now - t < this.windowMs);
    this.attempts.push(now);
    if (this.attempts.length >= this.max) {
      this.lockedUntil = now + Math.min(PAIR_LOCKOUT_MAX_MS, this.lockoutMs * 2 ** this.lockouts);
      this.lockouts++;
      this.attempts = [];
    }
  }

  reset(): void {
    this.attempts = [];
    this.lockedUntil = 0;
    this.lockouts = 0;
  }
}

// ── Addresses ───────────────────────────────────────────────────────────

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// IPv4 CIDR match ("10.0.0.0/8", "100.64.0.0/10", "192.168.1.5" = /32).
// IPv6 sources are matched only by exact literal or "::1". Node reports
// IPv4-mapped IPv6 ("::ffff:1.2.3.4") — unwrapped here.
export function ipInCidr(ip: string, cidr: string): boolean {
  const addr = ip.replace(/^::ffff:/i, "");
  const [base, bitsStr] = cidr.trim().split("/");
  if (addr.includes(":") || base.includes(":")) return addr.toLowerCase() === base.toLowerCase();
  const a = ipv4ToInt(addr), b = ipv4ToInt(base);
  if (a === null || b === null) return false;
  const bits = bitsStr === undefined ? 32 : Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

export function ipInAnyCidr(ip: string, cidrs: string[]): boolean {
  return cidrs.some((c) => ipInCidr(ip, c));
}

export const PRIVATE_CIDRS = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "127.0.0.0/8"];
export const TAILNET_CIDRS = ["100.64.0.0/10"];

// Is this address one we'd call "public" (reachable from the internet)?
export function isPublicAddress(host: string): boolean {
  const h = host.replace(/^::ffff:/i, "");
  if (h === "::1" || h === "::" || h === "0.0.0.0") return h === "0.0.0.0" || h === "::"; // wildcard binds count as public
  if (!isIpLiteral(h)) return false; // names are resolved later; caller decides
  if (h.includes(":")) return !/^(fe80|fc|fd)/i.test(h); // link-local / ULA are private
  return !ipInAnyCidr(h, [...PRIVATE_CIDRS, ...TAILNET_CIDRS]);
}

export type TransportKind = "lan" | "tailnet" | "tunnel" | "wan" | "relay";

// Heuristic label for how we reach a peer, from its address alone.
export function classifyTransport(host: string): TransportKind {
  const h = host.trim().toLowerCase();
  if (h.startsWith("relay://")) return "relay";
  if (h === "localhost" || h === "::1" || ipInCidr(h, "127.0.0.0/8")) return "tunnel";
  if (h.endsWith(".ts.net") || ipInAnyCidr(h, TAILNET_CIDRS)) return "tailnet";
  if (h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".home") || ipInAnyCidr(h, PRIVATE_CIDRS)) return "lan";
  if (!isIpLiteral(h) && !h.includes(".")) return "lan"; // bare hostname → local resolver
  return "wan";
}

// ── Discovery beacon ────────────────────────────────────────────────────

export function encodeBeaconString(b: Omit<Beacon, "t" | "v">): string {
  const beacon: Beacon = { t: "gitgud-peer", v: PROTOCOL_VERSION, ...b };
  return JSON.stringify(beacon);
}

export function parseBeacon(text: string): Beacon | null {
  try {
    const j = JSON.parse(text);
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
// IPv4/IPv6 literal vs. a name (mDNS `.local`, Tailscale MagicDNS, DDNS…).
// Names are stable identities the user chose; LAN discovery must never
// overwrite them with whatever IP the beacon happens to report.
export function isIpLiteral(host: string): boolean {
  const h = host.trim().replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  return /^[0-9a-f:]+(%[a-z0-9]+)?$/i.test(h) && h.includes(":");
}

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

// ── QR pairing payload ──────────────────────────────────────────────────
// gitgud-peer://pair?v=1&h=<host>&p=<port>&fp=<fingerprint>&c=<code>&alt=<host2,host3>&r=<relay url>
// Carries everything a new device needs in one scan: where to connect, which
// certificate to pin BEFORE the first request (no TOFU window) and the code.
export type PairingQrPayload = { host: string; port: number; fingerprint: string; code: string; alts?: string[]; relay?: string; name?: string };

export function pairingQrPayload(p: PairingQrPayload): string {
  const q = new URLSearchParams();
  q.set("v", "1"); q.set("h", p.host); q.set("p", String(p.port));
  q.set("fp", p.fingerprint.replace(/:/g, "").toUpperCase()); q.set("c", p.code);
  if (p.alts?.length) q.set("alt", p.alts.join(","));
  if (p.relay) q.set("r", p.relay);
  if (p.name) q.set("n", p.name);
  return `gitgud-peer://pair?${q.toString()}`;
}

export function parsePairingQr(text: string): PairingQrPayload | null {
  const m = /^gitgud-peer:\/\/pair\?(.*)$/.exec(text.trim());
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const host = q.get("h") ?? "", port = Number(q.get("p") ?? DEFAULT_SERVER_PORT), fpHex = (q.get("fp") ?? "").toUpperCase(), code = q.get("c") ?? "";
  if (!host || !validPort(port) || !/^[0-9A-F]{64}$/.test(fpHex) || !/^\d{6}$/.test(code)) return null;
  const fingerprint = fpHex.match(/.{2}/g)!.join(":");
  const alts = (q.get("alt") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { host, port, fingerprint, code, alts: alts.length ? alts : undefined, relay: q.get("r") ?? undefined, name: q.get("n") ?? undefined };
}

// ── Rendezvous / relay (M5) ─────────────────────────────────────────────
// A tiny public service that (1) knows which hosts are online and (2) splices
// a client's TCP stream to a host's. Everything after the splice is the
// host's pinned TLS: the relay sees ciphertext only. Control frames are
// newline-delimited JSON on the relay's own TLS listener.
//
//   host   → relay : {"t":"register","peerId","token","fph"}   fph = sha256(host cert fingerprint)
//   relay  → host  : {"t":"registered"} | {"t":"error","error"}
//   relay  → host  : {"t":"incoming","conn"}                     a client wants you
//   host   → relay : (new connection) {"t":"accept","conn","peerId","token"} → {"t":"ok"} then raw
//   client → relay : {"t":"connect","peerId","fph"}              must know the fingerprint → no enumeration
//   relay  → client: {"t":"ok"} then raw | {"t":"error","error"}
//   either → relay : {"t":"ping"} → {"t":"pong"}
export const RELAY_DEFAULT_PORT = 47833;
export const RELAY_URI_SCHEME = "relay://";
export const RELAY_KEEPALIVE_MS = 25_000;
export const RELAY_ACCEPT_TIMEOUT_MS = 10_000;

export type RelayFrame =
  | { t: "register"; peerId: string; token: string; fph: string; name?: string }
  | { t: "registered" }
  | { t: "incoming"; conn: string }
  | { t: "accept"; conn: string; peerId: string; token: string }
  | { t: "connect"; peerId: string; fph: string }
  | { t: "ok" }
  | { t: "error"; error: string }
  | { t: "ping" }
  | { t: "pong" };

export function encodeRelayFrame(f: RelayFrame): string {
  return JSON.stringify(f) + "\n";
}

export function parseRelayFrame(line: string): RelayFrame | null {
  try {
    const j = JSON.parse(line) as RelayFrame;
    return j && typeof j.t === "string" ? j : null;
  } catch { return null; }
}

/** Configured relay (`relay://host:port#fp`) + this host's id → the route clients dial (`relay://host:port/<peerId>#fp`). */
export function relayRouteFor(relayUrl: string | null | undefined, peerId: string): string | undefined {
  if (!relayUrl) return undefined;
  const u = relayUrl.trim();
  if (!u) return undefined;
  const hash = u.includes("#") ? "#" + u.split("#")[1] : "";
  const base = u.replace(/#.*$/, "").replace(/\/+$/, "").replace(/\/[0-9a-f]{8,64}$/, "");
  return `${base}/${peerId}${hash}`;
}

/** SNI host name a plain-HTTPS client uses to reach `peerId` through a relay (the relay routes on the first label). */
export function relaySniHost(peerId: string): string { return `${peerId}.gitgud-relay`; }

// relay://relay.example.com:47833[/<peerId>][#<relay cert fingerprint hex>]
export function parseRelayUrl(input: string): { host: string; port: number; peerId?: string; fingerprint?: string } | null {
  const m = /^relay:\/\/([^/#]+)(?:\/([0-9a-f]{8,64}))?(?:#([0-9A-Fa-f:]{64,95}))?$/.exec(input.trim());
  if (!m) return null;
  const hp = parseHostPort(m[1], RELAY_DEFAULT_PORT);
  if (!hp) return null;
  return { host: hp.host, port: hp.port, peerId: m[2], fingerprint: m[3]?.replace(/:/g, "").toUpperCase() };
}

export function isRelayAddress(host: string | null | undefined): boolean {
  return typeof host === "string" && host.startsWith(RELAY_URI_SCHEME);
}
