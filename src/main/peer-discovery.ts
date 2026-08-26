import * as dgram from "dgram";
import { EventEmitter } from "events";
import { BEACON_INTERVAL_MS, BEACON_TTL_MS, DISCOVERY_PORT, encodeBeacon, parseBeacon, type Beacon } from "./peer-protocol";

// LAN discovery: hosts that share broadcast a small JSON beacon every few
// seconds; every instance listens and keeps a TTL'd table. Manual host:port
// entry remains the fallback for networks that filter broadcast.

export type DiscoveredPeer = {
  peerId: string;
  name: string;
  address: string;
  port: number;
  version: string;
  lastSeen: number;
};

export class PeerDiscovery extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private beacon: Omit<Beacon, "t" | "v"> | null = null;
  private sendTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private peers = new Map<string, DiscoveredPeer>();

  constructor(private selfPeerId: string, private port = DISCOVERY_PORT) {
    super();
  }

  list(): DiscoveredPeer[] {
    return [...this.peers.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // Listen for beacons. Safe to call repeatedly.
  start(): void {
    if (this.socket) return;
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    sock.on("error", (e) => {
      this.emit("error", e);
      // Bind failures (port in use without reuse) leave discovery off; manual
      // connect still works.
      try { sock.close(); } catch { /* ignore */ }
      if (this.socket === sock) this.socket = null;
    });
    sock.on("message", (msg, rinfo) => this.onMessage(msg, rinfo.address));
    sock.bind(this.port, () => {
      try { sock.setBroadcast(true); } catch { /* not fatal */ }
    });
    this.socket = sock;
    this.sweepTimer = setInterval(() => this.sweep(), BEACON_INTERVAL_MS);
  }

  stop(): void {
    this.setBeacon(null);
    if (this.sweepTimer) { clearInterval(this.sweepTimer); this.sweepTimer = null; }
    if (this.socket) {
      try { this.socket.close(); } catch { /* ignore */ }
      this.socket = null;
    }
    if (this.peers.size) { this.peers.clear(); this.emit("change"); }
  }

  // Announce (or stop announcing) this instance as a host.
  setBeacon(b: Omit<Beacon, "t" | "v"> | null): void {
    this.beacon = b;
    if (this.sendTimer) { clearInterval(this.sendTimer); this.sendTimer = null; }
    if (!b) return;
    this.sendBeacon();
    this.sendTimer = setInterval(() => this.sendBeacon(), BEACON_INTERVAL_MS);
  }

  private sendBeacon(): void {
    if (!this.socket || !this.beacon) return;
    const buf = encodeBeacon(this.beacon);
    // Broadcast for the LAN plus loopback so a second instance on this same
    // machine (dev next to installed) sees us even when broadcast isn't
    // delivered back to the sender.
    for (const addr of ["255.255.255.255", "127.0.0.1"]) {
      try { this.socket.send(buf, 0, buf.length, this.port, addr); } catch { /* transient */ }
    }
  }

  private onMessage(msg: Buffer, address: string): void {
    const b = parseBeacon(msg);
    if (!b || b.peerId === this.selfPeerId) return;
    const prev = this.peers.get(b.peerId);
    const next: DiscoveredPeer = { peerId: b.peerId, name: b.name, address, port: b.port, version: b.version, lastSeen: Date.now() };
    this.peers.set(b.peerId, next);
    if (!prev || prev.name !== next.name || prev.address !== next.address || prev.port !== next.port) this.emit("change");
  }

  private sweep(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of this.peers) {
      if (now - p.lastSeen > BEACON_TTL_MS) { this.peers.delete(id); changed = true; }
    }
    if (changed) this.emit("change");
  }
}
