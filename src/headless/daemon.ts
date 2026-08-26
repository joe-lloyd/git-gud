// The daemon proper: config → PeerStore → PeerServer (+ discovery, control
// socket). Exported as a function so tests can run it in-process.
import * as fs from "fs";
import * as os from "os";
import { join } from "path";
import type { Server as NetServer } from "net";
import { GitService } from "../main/git-service";
import { PeerDiscovery } from "../main/peer-discovery";
import { createPeerServerHost, createRepoHost } from "../main/peer-host-core";
import { PeerServer } from "../main/peer-server";
import { PeerStore, plainCrypter } from "../main/peer-store";
import { shortFingerprint } from "../main/peer-tls";
import { configPath, effectiveReadOnly, ensureDirs, loadConfig, resolveBindAddress, type HeadlessConfig, type HeadlessPaths } from "./config";
import { ipInAnyCidr } from "@gitgud/peer-protocol";
import { startControlServer, type ControlRequest } from "./control";
import type { Logger } from "./log";
import { ConfigRepoAllowList } from "./repos";
import { AuditLog } from "./audit";
import { createRepoWatcher, pushSubscribers } from "../main/peer-host-core";
import { RelayLink } from "../main/peer-relay";
import { PushNotifier } from "../main/peer-push";

export interface DaemonOptions {
  paths: HeadlessPaths;
  version: string;
  log: Logger;
  // Override the file-based config (tests).
  config?: HeadlessConfig;
}

export interface RunningDaemon {
  port: number;
  bindAddress: string;
  fingerprint: string;
  peerId: string;
  socketPath: string;
  server: PeerServer;
  store: PeerStore;
  requestPairingCode(): { code: string; fingerprint: string; expiresAt: number; addresses: string[]; relay?: string };
  reload(): void;
  stop(): Promise<void>;
}

export async function startDaemon(opts: DaemonOptions): Promise<RunningDaemon> {
  const { paths, log } = opts;
  ensureDirs(paths);
  let cfg = opts.config ?? loadConfig(paths);

  const store = new PeerStore(paths.dataDir, plainCrypter);
  store.updateSettings({ name: cfg.name, port: cfg.port, readOnly: cfg.readOnly, enabled: true });
  const tls = store.getTls();
  assertPrivateKeyPerms(join(paths.dataDir, "peer-tls-key.pem"), log);

  const audit = new AuditLog(join(paths.stateDir, "audit.log"));
  const allow = new ConfigRepoAllowList(() => cfg.repos, () => cfg.scanRoots, (m) => log.level("warn", m));
  allow.refresh();

  const repos = createRepoHost<GitService>({
    allowList: () => allow.current(),
    // No provider tokens on a daemon: the box's own SSH agent / credential
    // helper authenticates remotes, exactly as `git` in a shell would.
    factory: (canonical) => new GitService(canonical, () => [], (rec) => {
      if (rec.kind === "write") audit.write("git-write", { repo: rec.repoPath, args: rec.args.slice(0, 3), failed: rec.failed });
    }),
    log: (m) => log(m),
  });

  // Pairing is closed until the CLI asks for a code; the code then lives for
  // `pairingWindowMinutes` or one use.
  let pairingUntil = 0;
  const pairingOpen = () => Date.now() < pairingUntil;

  let bindAddress = resolveBindAddress(cfg.bind);
  const readOnlyNow = () => {
    const r = effectiveReadOnly(cfg, bindAddress);
    return r.readOnly;
  };
  const warnIfForced = () => {
    const r = effectiveReadOnly(cfg, bindAddress);
    if (r.forced) log.level("warn", `bind ${bindAddress} is a public address: forcing read-only (set allowWritesOnPublicBind to override — and read docs/headless.md first)`);
  };
  warnIfForced();

  const host = createPeerServerHost({
    store,
    repos,
    version: opts.version,
    platform: "linux-headless",
    readOnly: readOnlyNow,
    allowSource: (ip) => cfg.allowSourceCidrs.length === 0 || ipInAnyCidr(ip, cfg.allowSourceCidrs),
    infoPublic: () => cfg.infoPublic,
    tokenTtlMs: () => cfg.tokenTtlDays * 86_400_000,
    heartbeatMs: () => cfg.heartbeatSeconds * 1000,
    onPairAttempt: (ip, ok, peerId8, name) => audit.write(ok ? "pair-ok" : "pair-refused", { ip, peerId8, name }),
    denyMethods: () => new Set(cfg.denyMethods),
    pairingOpen,
    pushEnabled: () => cfg.push,
    onPaired: (peerId, name) => {
      pairingUntil = 0; // one code, one pairing
      audit.write("paired", { peerId: peerId.slice(0, 8), name });
      log("paired", { peer: name, peerId8: peerId.slice(0, 8) });
    },
    log: (m) => log(m),
  });
  // Optional peer-id allow-list on top of the code.
  const baseRegister = host.registerPaired;
  host.registerPaired = (peerId, name, token, o) => {
    if (cfg.allowPeerIds.length && !cfg.allowPeerIds.includes(peerId)) {
      audit.write("pair-refused-allowlist", { peerId: peerId.slice(0, 8), name });
      throw new Error("This peer id is not on the host's allowPeerIds list");
    }
    baseRegister(peerId, name, token, o);
  };

  // Push: watch every served repo while opted in (SSE watchers only exist
  // while a client is connected; phones in the background have no stream).
  const push = new PushNotifier({ enabled: () => cfg.push, subscribers: () => pushSubscribers(store), machineName: () => cfg.name, log: (m) => log.level("warn", m) });
  const pushWatchers = new Map<string, () => void>();
  const applyPushWatchers = () => {
    const want = cfg.push ? [...allow.current().keys()] : [];
    for (const [p, stop] of pushWatchers) if (!want.includes(p)) { stop(); pushWatchers.delete(p); }
    for (const p of want) if (!pushWatchers.has(p)) pushWatchers.set(p, createRepoWatcher(p, (kind) => { if (kind === "repo") push.notify(p, "repo-changed"); }, { worktree: true }));
  };
  applyPushWatchers();

  const server = new PeerServer(host);
  const port = await server.start(cfg.port, bindAddress, 0);
  log("serving", { bind: `${bindAddress}:${port}`, readOnly: readOnlyNow(), repos: allow.current().size, fingerprint: shortFingerprint(tls.fingerprint), sourceFilter: cfg.allowSourceCidrs.join(",") || "any" });

  // Rendezvous/relay registration (M5): outbound only; peers anywhere reach
  // us through the relay with our fingerprint in hand (QR / payload).
  let relay: RelayLink | null = null;
  const applyRelay = () => {
    const want = cfg.rendezvous?.url;
    if (!want) { relay?.stop(); relay = null; return; }
    if (relay && relay["o"].relayUrl === want) return;
    relay?.stop();
    relay = new RelayLink({
      relayUrl: want, peerId: store.getIdentity().peerId, token: cfg.rendezvous!.token, name: cfg.name,
      fingerprint: () => tls.fingerprint,
      onSocket: (sock) => { if (!server.injectConnection(sock)) sock.destroy(); },
      log: (m) => log.level("warn", m),
    });
    relay.on("status", (st: string) => log("relay", { status: st, error: relay?.lastError || undefined }));
    relay.start();
  };
  applyRelay();

  let discovery: PeerDiscovery | null = null;
  const applyDiscovery = () => {
    if (cfg.discovery && !discovery) {
      discovery = new PeerDiscovery(store.getIdentity().peerId);
      discovery.on("error", (e) => log.level("warn", `discovery: ${String(e)}`));
      discovery.start();
      discovery.setBeacon({ peerId: store.getIdentity().peerId, name: cfg.name, port, version: opts.version });
    } else if (!cfg.discovery && discovery) {
      discovery.stop();
      discovery = null;
    }
  };
  applyDiscovery();

  const addresses = () => {
    const out: string[] = [];
    if (bindAddress !== "0.0.0.0" && bindAddress !== "::") out.push(`${bindAddress}:${port}`);
    else for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if ((a.family === "IPv4" || (a.family as unknown) === 4) && !a.internal) out.push(`${a.address}:${port}`);
    out.push(`${os.hostname()}:${port}`);
    return out;
  };

  const requestPairingCode = () => {
    const code = server.regenerateCode();
    pairingUntil = Date.now() + cfg.pairingWindowMinutes * 60_000;
    audit.write("pairing-code-issued", {});
    log("pairing window opened", { minutes: cfg.pairingWindowMinutes });
    const relayAddr = cfg.rendezvous?.url ? `${cfg.rendezvous.url.replace(/#.*$/, "").replace(/\/$/, "")}/${store.getIdentity().peerId}${cfg.rendezvous.url.includes("#") ? "#" + cfg.rendezvous.url.split("#")[1] : ""}` : undefined;
    return { code, fingerprint: tls.fingerprint, expiresAt: pairingUntil, addresses: addresses(), relay: relayAddr };
  };

  const reload = () => {
    try {
      if (!opts.config) cfg = loadConfig(paths);
      store.updateSettings({ name: cfg.name, readOnly: cfg.readOnly });
      try { bindAddress = resolveBindAddress(cfg.bind); } catch (e) { log.level("warn", `reload: ${String(e)} — keeping ${bindAddress} until restart`); }
      warnIfForced();
      allow.refresh();
      repos.prune();
      applyDiscovery();
      applyPushWatchers();
      applyRelay();
      log("reloaded", { repos: allow.current().size, readOnly: cfg.readOnly });
    } catch (e) {
      log.level("error", `reload failed: ${String(e)} — keeping previous config`);
    }
  };

  const socketPath = join(paths.runtimeDir, "control.sock");
  let control: NetServer | null = null;
  const stop = async () => {
    for (const s of pushWatchers.values()) s();
    push.stop();
    relay?.stop();
    discovery?.stop();
    server.stop();
    await new Promise<void>((r) => (control ? control.close(() => r()) : r()));
    try { fs.unlinkSync(socketPath); } catch { /* gone */ }
    log("stopped");
  };
  control = await startControlServer(socketPath, async (req: ControlRequest) => {
    switch (req.cmd) {
      case "status":
        return {
          version: opts.version, peerId: store.getIdentity().peerId, name: cfg.name, bind: `${bindAddress}:${port}`,
          readOnly: readOnlyNow(), readOnlyForced: effectiveReadOnly(cfg, bindAddress).forced, fingerprint: tls.fingerprint, repos: [...allow.current().keys()],
          allowSourceCidrs: cfg.allowSourceCidrs, tokenTtlDays: cfg.tokenTtlDays, infoPublic: cfg.infoPublic,
          relay: cfg.rendezvous?.url ? { url: cfg.rendezvous.url, status: relay?.status ?? "offline", error: relay?.lastError ?? "" } : null,
          paired: store.listPaired().map((d) => ({ peerId: d.peerId, name: d.name, kind: d.kind, readOnly: d.readOnly === true, connected: server.connectedDevices().some((c) => c.peerId === d.peerId) })),
          pairingOpen: pairingOpen(), pairingExpiresAt: pairingUntil || null, configFile: configPath(paths), pid: process.pid,
        };
      case "pair": return requestPairingCode();
      case "devices": return store.listPaired().map((d) => ({ peerId: d.peerId, name: d.name, kind: d.kind ?? "desktop", readOnly: d.readOnly === true, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt ?? null }));
      case "revoke": {
        const ok = store.revokePaired(req.peerId);
        if (ok) audit.write("revoked", { peerId: req.peerId.slice(0, 8) });
        return { revoked: ok };
      }
      case "reload": reload(); return { reloaded: true };
      case "tls": {
        if (req.action === "rotate") {
          const next = store.rotateTls();
          server.stop();
          await server.start(cfg.port, bindAddress, 0);
          audit.write("tls-rotated", { fingerprint: next.fingerprint });
          log("tls rotated — every paired device must pair again", { fingerprint: shortFingerprint(next.fingerprint) });
          return { fingerprint: next.fingerprint, rotated: true };
        }
        return { fingerprint: tls.fingerprint, rotated: false };
      }
      case "stop": setTimeout(() => { stop().then(() => process.exit(0)); }, 50); return { stopping: true };
      default: throw new Error(`unknown command`);
    }
  });

  return { port, bindAddress, fingerprint: tls.fingerprint, peerId: store.getIdentity().peerId, socketPath, server, store, requestPairingCode, reload, stop };
}

// Refuse to serve with a group/world-readable private key: the key IS the
// host's identity for every paired device.
function assertPrivateKeyPerms(keyFile: string, log: Logger): void {
  if (process.platform === "win32") return;
  try {
    const mode = fs.statSync(keyFile).mode & 0o777;
    if (mode & 0o077) {
      fs.chmodSync(keyFile, 0o600);
      log.level("warn", `tightened permissions on ${keyFile} (was ${mode.toString(8)})`);
    }
  } catch { /* store creates it 0600 */ }
}
