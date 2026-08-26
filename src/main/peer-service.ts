import { PeerStore, type Crypter, type KnownPeer } from "./peer-store";
import { PeerServer, type PeerServerHost } from "./peer-server";
import * as os from "os";
import { createPeerServerHost, pushSubscribers } from "./peer-host-core";
import { PushNotifier } from "./peer-push";
import { renderQrSvg } from "./qr";
import { PeerDiscovery } from "./peer-discovery";
import { PeerConnection, createRemoteRepoProxy, type PeerStatus } from "./peer-client";
import {
  isIpLiteral,
  PROTOCOL_VERSION,
  makePeerRepoPath,
  parsePeerRepoPath,
  isPeerRepoPath,
  type PeerEvent,
  type PeerInfo,
  type PeerRepoSummary,
  pairingQrPayload,
} from "./peer-protocol";
import type { GitActivity } from "./git-service";

// Glue between the peer modules and the app: owns the store, the (optional)
// server, discovery and one PeerConnection per known peer; hands main a
// GitService look-alike for gitgud-peer:// tab paths; publishes a state
// snapshot the renderer renders verbatim.

export type PeerStateSnapshot = {
  self: { peerId: string; name: string };
  server: {
    enabled: boolean;
    running: boolean;
    port: number;
    readOnly: boolean;
    push: boolean;
    pairingCode: string;
    fingerprint: string;
    error: string;
    paired: Array<{ peerId: string; name: string; createdAt: number; connected: boolean; readOnly: boolean; kind: string }>;
  };
  discovered: Array<{ peerId: string; name: string; address: string; port: number; version: string; known: boolean }>;
  peers: Array<{ peerId: string; name: string; host: string; port: number; status: PeerStatus; error: string }>;
};

export interface PeerServiceDeps {
  userDataDir: string;
  crypter: Crypter;
  appVersion: string;
  // Host side: what this instance is willing to serve.
  listLocalRepos(): PeerRepoSummary[];
  resolveLocalRepo(repoPath: string): Promise<object | null>;
  watchLocalRepo(repoPath: string, onEvent: (ev: PeerEvent) => void): () => void;
  // Client side: things that happened on a peer, translated to peer URIs.
  onRemoteRepoChanged(peerRepoPath: string, kind: "repo" | "gitignore"): void;
  onActivity(rec: GitActivity): void;
  // Push a fresh state snapshot to the renderer.
  publish(state: PeerStateSnapshot): void;
  log?(msg: string): void;
}

export class PeerService {
  private store: PeerStore;
  private server: PeerServer;
  private discovery: PeerDiscovery;
  private connections = new Map<string, PeerConnection>();
  private proxies = new Map<string, object>(); // peerRepoPath → proxy
  private serverError = "";
  private push: PushNotifier;
  private publishTimer: NodeJS.Timeout | null = null;

  constructor(private deps: PeerServiceDeps) {
    this.store = new PeerStore(deps.userDataDir, deps.crypter);
    const identity = () => this.store.getIdentity();
    const host: PeerServerHost = createPeerServerHost({
      store: this.store,
      repos: {
        listRepos: () => deps.listLocalRepos(),
        resolveRepo: (p) => deps.resolveLocalRepo(p),
        watchRepo: (p, cb) => deps.watchLocalRepo(p, cb),
        prune: () => {},
      },
      version: deps.appVersion,
      platform: process.platform,
      readOnly: () => this.store.getSettings().readOnly,
      pushEnabled: () => this.store.getSettings().push,
      onPaired: () => this.schedulePublish(),
      log: deps.log,
    });
    this.push = new PushNotifier({
      enabled: () => this.store.getSettings().push,
      subscribers: () => pushSubscribers(this.store),
      machineName: () => this.store.getSettings().name,
      log: deps.log,
    });
    this.server = new PeerServer(host);
    this.discovery = new PeerDiscovery(identity().peerId);
    this.discovery.on("change", () => {
      // Discovery doubles as address book refresh for peers that moved IPs.
      // A peer saved under a *name* (Tailscale MagicDNS, DDNS, .local) keeps
      // that name — it's how we reach it from another network. The LAN
      // address is only used as a live fallback while the name isn't
      // answering, and never persisted over the name.
      for (const d of this.discovery.list()) {
        const known = this.store.getKnown(d.peerId);
        if (!known) continue;
        const conn = this.connections.get(d.peerId);
        if (isIpLiteral(known.host)) {
          this.store.touchKnown(d.peerId, { host: d.address, port: d.port, name: d.name });
          conn?.updateEndpoint({ host: d.address, port: d.port, name: d.name });
        } else {
          this.store.touchKnown(d.peerId, { name: d.name });
          if (conn && conn.status !== "connected" && conn.status !== "connecting") {
            conn.updateEndpoint({ host: d.address, port: d.port, name: d.name });
          }
        }
      }
      this.schedulePublish();
    });
    this.discovery.on("error", (e) => deps.log?.(`peer-discovery: ${String(e)}`));
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  async init(): Promise<void> {
    this.discovery.start();
    if (this.store.getSettings().enabled) await this.startServer();
    for (const k of this.store.listKnown()) this.ensureConnection(k).connect();
    this.schedulePublish();
  }

  shutdown(): void {
    this.server.stop();
    this.discovery.stop();
    for (const c of this.connections.values()) c.disconnect();
  }

  getState(): PeerStateSnapshot {
    const s = this.store.getSettings();
    const connectedIds = new Set(this.server.connectedDevices().map((d) => d.peerId));
    const knownIds = new Set(this.store.listKnown().map((k) => k.peerId));
    return {
      self: this.store.getIdentity(),
      server: {
        enabled: s.enabled,
        running: this.server.isListening,
        port: this.server.isListening ? this.server.listeningPort : s.port,
        readOnly: s.readOnly,
        pairingCode: this.server.isListening ? this.server.code : "",
        fingerprint: this.server.isListening ? this.store.getTls().fingerprint : "",
        error: this.serverError,
        paired: this.store.listPaired().map((d) => ({ peerId: d.peerId, name: d.name, createdAt: d.createdAt, connected: connectedIds.has(d.peerId), readOnly: d.readOnly === true, kind: d.kind ?? "desktop" })),
      },
      discovered: this.discovery.list().map((d) => ({ peerId: d.peerId, name: d.name, address: d.address, port: d.port, version: d.version, known: knownIds.has(d.peerId) })),
      peers: this.store.listKnown().map((k) => {
        const c = this.connections.get(k.peerId);
        return { peerId: k.peerId, name: k.name, host: k.host, port: k.port, status: c?.status ?? "offline", error: c?.lastError ?? "" };
      }),
    };
  }

  // ── Host (sharing) ──────────────────────────────────────────────────

  async setServer(patch: { enabled?: boolean; port?: number; name?: string; readOnly?: boolean; push?: boolean }): Promise<PeerStateSnapshot> {
    const before = this.store.getSettings();
    const after = this.store.updateSettings(patch);
    const restart = after.enabled && this.server.isListening && after.port !== before.port;
    if (!after.enabled && this.server.isListening) this.stopServer();
    else if (after.enabled && (!this.server.isListening || restart)) {
      if (restart) this.stopServer();
      await this.startServer();
    } else if (this.server.isListening) {
      // Name change → refresh the beacon payload.
      this.discovery.setBeacon(this.beaconPayload());
    }
    this.schedulePublish();
    return this.getState();
  }

  regenerateCode(): string {
    const c = this.server.regenerateCode();
    this.schedulePublish();
    return c;
  }

  setDeviceReadOnly(peerId: string, readOnly: boolean): boolean {
    const ok = this.store.setPairedReadOnly(peerId, readOnly);
    if (ok) this.schedulePublish();
    return ok;
  }

  revokeDevice(peerId: string): boolean {
    const ok = this.store.revokePaired(peerId);
    this.schedulePublish();
    return ok;
  }

  broadcastActivity(rec: GitActivity): void {
    if (this.server.isListening) this.server.broadcastActivity(rec.repoPath, rec);
    if (rec.kind === "write" && !rec.failed) this.push.notify(rec.repoPath, "activity", rec.args[0]);
  }

  // Local repo changed (watcher on this machine) → phones that subscribed.
  notifyRepoChanged(repoPath: string): void {
    this.push.notify(repoPath, "repo-changed");
  }

  // QR pairing payload for the companion app: current code + fingerprint +
  // every address this host is likely reachable at.
  pairingQr(): { payload: string; svg: string } | null {
    if (!this.server.isListening) return null;
    const port = this.server.listeningPort;
    const addrs: string[] = [];
    for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if ((a.family === "IPv4" || (a.family as unknown) === 4) && !a.internal) addrs.push(a.address);
    const host = addrs[0] ?? os.hostname();
    const alts = [...addrs.slice(1), os.hostname()].filter((h) => h !== host);
    const payload = pairingQrPayload({ host, port, fingerprint: this.store.getTls().fingerprint, code: this.server.code, alts, name: this.store.getSettings().name });
    return { payload, svg: renderQrSvg(payload, { size: 220 }) };
  }

  private async startServer(): Promise<void> {
    try {
      const port = await this.server.start(this.store.getSettings().port);
      this.serverError = "";
      this.discovery.setBeacon(this.beaconPayload(port));
      this.deps.log?.(`peer-server: sharing on port ${port}`);
    } catch (e) {
      this.serverError = `Could not start sharing: ${e instanceof Error ? e.message : String(e)}`;
      this.deps.log?.(this.serverError);
    }
  }

  private stopServer(): void {
    this.server.stop();
    this.discovery.setBeacon(null);
  }

  private beaconPayload(port = this.server.listeningPort) {
    const id = this.store.getIdentity();
    return { peerId: id.peerId, name: id.name, port, version: this.deps.appVersion };
  }

  // ── Client (connecting) ─────────────────────────────────────────────

  // First contact (trust-on-first-use): learn the host's certificate. The
  // fingerprint is surfaced so the user can compare it with the host's
  // Settings before typing the code.
  async probe(host: string, port: number): Promise<PeerInfo> {
    return (await PeerConnection.probe(host, port)).info;
  }

  async pair(host: string, port: number, code: string): Promise<{ peerId: string; name: string }> {
    const { info, certPem } = await PeerConnection.probe(host, port);
    if (info.peerId === this.store.getIdentity().peerId) throw new Error("That's this instance — pick another machine.");
    const { token, peer } = await PeerConnection.pair(host, port, code, this.store.getIdentity(), certPem);
    const known = this.store.upsertKnown({ peerId: peer.peerId, name: peer.name, host, port, token, certPem });
    // A fresh token replaces whatever connection state we had.
    this.connections.get(peer.peerId)?.disconnect();
    this.connections.delete(peer.peerId);
    this.ensureConnection(known).connect();
    this.schedulePublish();
    return { peerId: peer.peerId, name: peer.name };
  }

  connect(peerId: string): boolean {
    const k = this.store.getKnown(peerId);
    if (!k) return false;
    const c = this.ensureConnection(k);
    if (c.status === "revoked") return false;
    c.connect();
    this.schedulePublish();
    return true;
  }

  disconnect(peerId: string): void {
    this.connections.get(peerId)?.disconnect();
    this.schedulePublish();
  }

  forget(peerId: string): string[] {
    this.connections.get(peerId)?.disconnect();
    this.connections.delete(peerId);
    this.store.forgetKnown(peerId);
    // Tell the caller which tab paths just became orphans.
    const dropped = [...this.proxies.keys()].filter((p) => parsePeerRepoPath(p)?.peerId === peerId);
    for (const p of dropped) this.proxies.delete(p);
    this.schedulePublish();
    return dropped;
  }

  async listRepos(peerId: string): Promise<PeerRepoSummary[]> {
    const c = this.connections.get(peerId);
    if (!c) throw new Error("Peer is not known — pair with it first.");
    return c.listRepos();
  }

  peerName(peerId: string): string {
    return this.store.getKnown(peerId)?.name ?? this.discovery.list().find((d) => d.peerId === peerId)?.name ?? peerId.slice(0, 8);
  }

  // ── Repo resolution for main ────────────────────────────────────────

  // Returns a GitService look-alike for a gitgud-peer:// path (cached), or
  // null when the peer is unknown. Doesn't touch the network — the first
  // method call does.
  resolvePeerRepo(peerRepoPath: string): object | null {
    const cached = this.proxies.get(peerRepoPath);
    if (cached) return cached;
    const parsed = parsePeerRepoPath(peerRepoPath);
    if (!parsed) return null;
    const known = this.store.getKnown(parsed.peerId);
    if (!known) return null;
    const connection = this.ensureConnection(known);
    connection.connect();
    const proxy = createRemoteRepoProxy({
      connection,
      remotePath: parsed.remotePath,
      peerRepoPath,
      onActivity: this.deps.onActivity,
    });
    this.proxies.set(peerRepoPath, proxy);
    this.refreshSubscriptions(parsed.peerId);
    return proxy;
  }

  dropPeerRepo(peerRepoPath: string): void {
    const parsed = parsePeerRepoPath(peerRepoPath);
    this.proxies.delete(peerRepoPath);
    if (parsed) this.refreshSubscriptions(parsed.peerId);
  }

  makePeerRepoPath(peerId: string, remotePath: string): string {
    return makePeerRepoPath(peerId, remotePath);
  }

  isPeerRepoPath(path: string | null | undefined): boolean {
    return isPeerRepoPath(path);
  }

  peerStatusFor(peerRepoPath: string): { name: string; status: PeerStatus; error: string } | null {
    const parsed = parsePeerRepoPath(peerRepoPath);
    if (!parsed) return null;
    const c = this.connections.get(parsed.peerId);
    return { name: this.peerName(parsed.peerId), status: c?.status ?? "offline", error: c?.lastError ?? "" };
  }

  // ── Internals ───────────────────────────────────────────────────────

  private ensureConnection(k: KnownPeer): PeerConnection {
    let c = this.connections.get(k.peerId);
    if (c) return c;
    c = new PeerConnection({ peerId: k.peerId, name: k.name, host: k.host, port: k.port, token: k.token, certPem: k.certPem }, this.store.getIdentity());
    c.on("status", () => this.schedulePublish());
    c.on("event", (ev: PeerEvent) => this.onPeerEvent(k.peerId, ev));
    this.connections.set(k.peerId, c);
    return c;
  }

  private onPeerEvent(peerId: string, ev: PeerEvent): void {
    if (ev.type === "repo-changed" || ev.type === "gitignore-changed") {
      this.deps.onRemoteRepoChanged(makePeerRepoPath(peerId, ev.repoPath), ev.type === "repo-changed" ? "repo" : "gitignore");
    } else if (ev.type === "activity") {
      const rec = ev.record as GitActivity | null;
      if (!rec || typeof rec !== "object" || typeof rec.repoPath !== "string") return;
      this.deps.onActivity({
        ...rec,
        id: `peer-${peerId.slice(0, 6)}-${rec.id}`,
        repoPath: makePeerRepoPath(peerId, rec.repoPath),
        args: [`@${this.peerName(peerId)}`, ...(Array.isArray(rec.args) ? rec.args : [])],
      });
    }
  }

  // Subscribe each connection to the host paths of every open proxy on it.
  private refreshSubscriptions(peerId: string): void {
    const c = this.connections.get(peerId);
    if (!c) return;
    const paths: string[] = [];
    for (const p of this.proxies.keys()) {
      const parsed = parsePeerRepoPath(p);
      if (parsed?.peerId === peerId) paths.push(parsed.remotePath);
    }
    c.setSubscriptions(paths);
  }

  private schedulePublish(): void {
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      try { this.deps.publish(this.getState()); } catch (e) { this.deps.log?.(`peer publish failed: ${String(e)}`); }
    }, 50);
  }
}
