// Host-side glue shared by the Electron app and the headless daemon.
// Electron-free on purpose: everything that actually serves peers lives here
// or below (peer-server / peer-store / peer-tls / peer-protocol / git-service).
//
//   Electron main  ─┐
//                   ├─► createRepoHost()  ─► PeerServerHost ─► PeerServer
//   gitgud-headless ┘      (allow-list, GitService cache, watchers)
import * as fs from "fs";
import { basename, join } from "path";
import { generateToken, type PeerEvent, type PeerInfo, type PeerRepoSummary } from "./peer-protocol";
import type { PeerServerHost } from "./peer-server";
import type { PeerStore } from "./peer-store";
import { isExpoPushToken, type PushSubscriber } from "./peer-push";

// ── Paths ───────────────────────────────────────────────────────────────

// Canonical form so /tmp/x and /private/tmp/x (macOS) or differently-cased
// Windows drives never show up as two repos.
export function canonicalPath(p: string): string {
  try { return fs.realpathSync.native(p); } catch { return p; }
}

// ── Repo watcher ────────────────────────────────────────────────────────

export type RepoWatchKind = "repo" | "gitignore";

// Watches a repo's refs/HEAD (+ .gitignore) and, with `worktree: true`, the
// working tree itself (recursive, .git and node_modules excluded). The local
// GUI doesn't need the working tree — it refreshes on window focus — but a
// peer looking at this repo from another machine has no focus event to lean
// on, so its watcher gets the full picture.
export function createRepoWatcher(
  repoPath: string,
  onEvent: (kind: RepoWatchKind) => void,
  opts: { worktree?: boolean } = {},
): () => void {
  const watchers: fs.FSWatcher[] = [];
  let timer: NodeJS.Timeout | null = null;

  // Coalesce bursts (a checkout fires many ref writes) and ignore events that
  // arrive while a refresh is in flight — those are echoes of our own reads.
  let busyUntil = 0;
  const emit = () => {
    if (Date.now() < busyUntil) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      busyUntil = Date.now() + 1500;
      onEvent("repo");
    }, 500);
  };

  // 1) Repo root — .gitignore changes.
  try {
    watchers.push(
      fs.watch(repoPath, { persistent: false }, (_evt, filename) => {
        if (filename && String(filename).endsWith(".gitignore")) onEvent("gitignore");
      }),
    );
  } catch { /* repo root unwatchable — ignore */ }

  // 2) .git internals — HEAD + refs/ + packed-refs (+ merge/rebase sentinels).
  // NOT .git/index or .git/logs: read-only ops touch those → refresh loops.
  // HEAD/packed-refs are watched via their parent dir: git writes them by
  // lock-then-rename and a file watch dies after the first rename on Windows.
  const gitDir = join(repoPath, ".git");
  const SENTINELS = new Set(["HEAD", "packed-refs", "MERGE_HEAD", "ORIG_HEAD"]);
  try {
    if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
      watchers.push(
        fs.watch(gitDir, { persistent: false }, (_evt, filename) => {
          if (filename && SENTINELS.has(String(filename).replace(/\.lock$/, ""))) emit();
        }),
      );
    }
  } catch { /* unwatchable — fall back to focus-refresh */ }
  const refsDir = join(gitDir, "refs");
  try {
    if (fs.existsSync(refsDir)) {
      watchers.push(fs.watch(refsDir, { persistent: false, recursive: true }, () => emit()));
    }
  } catch { /* recursive unsupported or transient */ }

  // 3) Working tree (peer watchers only).
  if (opts.worktree) {
    try {
      watchers.push(
        fs.watch(repoPath, { persistent: false, recursive: true }, (_evt, filename) => {
          if (!filename) return emit();
          const f = String(filename);
          if (f === ".git" || f.startsWith(".git/") || f.startsWith(".git\\")) return;
          if (/(^|[\\/])node_modules([\\/]|$)/.test(f)) return;
          emit();
        }),
      );
    } catch { /* recursive unsupported — refs-only watching still applies */ }
  }

  return () => {
    for (const w of watchers) { try { w.close(); } catch { /* ignore */ } }
    if (timer) { clearTimeout(timer); timer = null; }
  };
}

// ── Repo host: allow-list + GitService cache + watchers ─────────────────

// Anything that quacks like GitService (the server only needs `isRepo`).
export interface RepoService { isRepo(): Promise<boolean>; getWorktrees?(): Promise<Array<{ path: string }>> }

export interface RepoHostDeps<S extends RepoService> {
  // Canonical path → "open in a tab" flag. Recomputed on every call so the
  // list follows tabs/recents (GUI) or config/scan (daemon) without wiring.
  allowList(): Map<string, boolean>;
  // Reuse an existing service for a canonical path (the GUI's open tabs), or
  // null to fall through to the factory.
  reuseService?(canonical: string): S | null;
  factory(canonical: string): S;
  log?(msg: string): void;
}

export interface RepoHost {
  listRepos(): PeerRepoSummary[];
  resolveRepo(requested: string): Promise<object | null>;
  watchRepo(repoPath: string, onEvent: (ev: PeerEvent) => void): () => void;
  // Drop cached services whose path left the allow-list (daemon reload).
  prune(): void;
}

export function createRepoHost<S extends RepoService>(deps: RepoHostDeps<S>): RepoHost {
  const served = new Map<string, S>();
  // Worktrees of shared repos are servable too (switching worktrees on a
  // remote repo opens their path): worktree path → owning shared repo.
  const worktreeOwner = new Map<string, string>();
  let worktreeScanAt = 0;

  const serviceFor = async (repoPath: string): Promise<S | null> => {
    const reused = deps.reuseService?.(repoPath);
    if (reused) return reused;
    let svc = served.get(repoPath);
    if (!svc) {
      svc = deps.factory(repoPath);
      if (!(await svc.isRepo())) return null;
      served.set(repoPath, svc);
    }
    return svc;
  };

  const rescanWorktrees = async (): Promise<void> => {
    if (Date.now() - worktreeScanAt < 10_000) return; // misses are cheap, scans are not
    worktreeScanAt = Date.now();
    worktreeOwner.clear();
    for (const [main] of deps.allowList()) {
      const svc = await serviceFor(main).catch(() => null);
      if (!svc?.getWorktrees) continue;
      const list = await svc.getWorktrees().catch(() => null);
      for (const w of list ?? []) if (w && typeof w.path === "string") worktreeOwner.set(canonicalPath(w.path), main);
    }
  };

  return {
    listRepos: () => [...deps.allowList()].map(([path, open]) => ({ path, name: basename(path) || path, open })),
    resolveRepo: async (requested) => {
      const repoPath = canonicalPath(requested);
      if (!deps.allowList().has(repoPath)) {
        // Not shared directly — maybe it's a worktree of a shared repo.
        if (!worktreeOwner.has(repoPath)) await rescanWorktrees();
        const owner = worktreeOwner.get(repoPath);
        if (!owner || !deps.allowList().has(owner)) return null;
      }
      return serviceFor(repoPath);
    },
    watchRepo: (repoPath, onEvent) =>
      createRepoWatcher(
        repoPath,
        (kind) => onEvent(kind === "repo" ? { type: "repo-changed", repoPath } : { type: "gitignore-changed", repoPath }),
        { worktree: true },
      ),
    prune: () => {
      const allowed = deps.allowList();
      for (const p of [...served.keys()]) {
        const owner = worktreeOwner.get(p);
        if (!allowed.has(p) && !(owner && allowed.has(owner))) served.delete(p);
      }
    },
  };
}

// ── PeerServerHost from a RepoHost + PeerStore ──────────────────────────

export interface PeerServerHostDeps {
  store: PeerStore;
  repos: RepoHost;
  version: string;
  platform: string; // "darwin" | "win32" | "linux" | "linux-headless"
  readOnly(): boolean;
  // Methods refused even when writable (daemon default: setConfig,
  // writeFileContent — both can lead to arbitrary exec on the host).
  denyMethods?(): ReadonlySet<string>;
  // Daemon: pairing only while a code was requested via the CLI.
  pairingOpen?(): boolean;
  onPaired?(peerId: string, name: string): void;
  // Whether this host forwards change notifications to phones (opt-in).
  pushEnabled?(): boolean;
  // Hardening knobs (daemon): source CIDRs, minimal /info, token TTL, heartbeat.
  allowSource?(remoteAddress: string): boolean;
  infoPublic?(): boolean;
  tokenTtlMs?(): number; // 0 = never expires
  heartbeatMs?(): number;
  onPairAttempt?(remoteAddress: string, ok: boolean, peerId8: string, name: string): void;
  // Reciprocal pairing: the pairing initiator offered credentials for the
  // opposite direction — store them as a known peer and connect (GUI only).
  onReciprocal?(peer: { peerId: string; name: string; token: string; certPem: string; host: string; port: number; relay?: string }): void;
  // M7: relay route (`relay://host:port/<peerId>#fp`) advertised in /info so
  // paired clients learn how to reach us from anywhere.
  relayRoute?(): string | undefined;
  log?(msg: string): void;
}

export function createPeerServerHost(d: PeerServerHostDeps): PeerServerHost {
  return {
    info: (): PeerInfo => ({
      peerId: d.store.getIdentity().peerId,
      name: d.store.getSettings().name,
      version: d.version,
      platform: d.platform,
      protocol: 1,
      fingerprint: d.store.getTls().fingerprint,
      readOnly: d.readOnly(),
      ...(d.relayRoute?.() ? { relay: d.relayRoute() } : {}),
    }),
    tls: () => d.store.getTls(),
    readOnly: () => d.readOnly(),
    denyMethods: d.denyMethods,
    pairingOpen: d.pairingOpen,
    listRepos: () => d.repos.listRepos(),
    resolveRepo: (p) => d.repos.resolveRepo(p),
    watchRepo: (p, cb) => d.repos.watchRepo(p, cb),
    verifyToken: (t) => d.store.findByToken(t),
    registerPaired: (peerId, name, token, opts) => {
      d.store.addPaired(peerId, name, token, { ...opts, ttlMs: d.tokenTtlMs?.() || undefined });
      d.onPaired?.(peerId, name);
    },
    rotateToken: (device) => {
      const token = generateToken();
      const dev = d.store.rotatePairedToken(device.peerId, token, d.tokenTtlMs?.() || undefined);
      return dev ? { token, expiresAt: dev.expiresAt } : null;
    },
    allowSource: d.allowSource,
    infoPublic: d.infoPublic,
    heartbeatMs: d.heartbeatMs,
    onPairAttempt: d.onPairAttempt,
    subscribePush: (device, token, events) => {
      if (!d.pushEnabled?.()) return false;
      if (token !== null && !isExpoPushToken(token)) return false;
      return d.store.setPairedPush(device.peerId, token ? { token, events } : null);
    },
    touchDevice: (device) => d.store.touchPaired(device.peerId),
    registerReciprocal: d.onReciprocal,
    log: d.log,
  };
}

// Subscribers for the PushNotifier, straight from the paired-device list.
export function pushSubscribers(store: PeerStore): PushSubscriber[] {
  return store.listPaired().flatMap((p) => (p.push ? [{ peerId: p.peerId, pushToken: p.push.token, events: p.push.events as PushSubscriber["events"] }] : []));
}
