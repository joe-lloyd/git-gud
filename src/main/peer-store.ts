import * as fs from "fs";
import { join } from "path";
import { hostname } from "os";
import { DEFAULT_SERVER_PORT, generatePeerId, hashToken } from "./peer-protocol";
import { generateSelfSigned, validateIdentity, certFingerprint, type TlsIdentity } from "./peer-tls";

// Persistence for the peer feature — four small JSON files in userData.
// Electron-free: the caller injects a Crypter (safeStorage in the app, a
// pass-through in tests) so outbound tokens are encrypted at rest while the
// host side only ever stores token *hashes*.

export type PeerIdentity = { peerId: string; name: string };
export type PeerSettings = { enabled: boolean; port: number; name: string; readOnly: boolean; push: boolean };
// A device allowed to connect TO me. Only the SHA-256 of its token is kept.
export type PairedDevice = {
  peerId: string;
  name: string;
  tokenHash: string;
  createdAt: number;
  // Per-device read-only (companion phones default to true). Host-wide
  // read-only still applies on top.
  readOnly?: boolean;
  kind?: "desktop" | "companion" | "headless";
  lastSeenAt?: number;
  // Companion push subscription (Expo push token + event kinds).
  push?: { token: string; events: string[] };
  // Token expiry (ms epoch). Absent = never. Clients rotate before it hits.
  expiresAt?: number;
};
// A peer I connect TO. `token` is the raw bearer token (encrypted on disk);
// `certPem` is the host's pinned TLS certificate.
export type KnownPeer = { peerId: string; name: string; host: string; port: number; token: string; certPem: string; pairedAt: number; tokenExpiresAt?: number };

export interface Crypter {
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export const plainCrypter: Crypter = {
  encrypt: (s) => Buffer.from(s, "utf8"),
  decrypt: (b) => b.toString("utf8"),
};

export class PeerStore {
  private identityFile: string;
  private settingsFile: string;
  private pairedFile: string;
  private knownFile: string;
  private tlsKeyFile: string;
  private tlsCertFile: string;

  private identity: PeerIdentity;
  private tls: TlsIdentity | null = null;
  private settings: PeerSettings;
  private paired: PairedDevice[] = [];
  private known: KnownPeer[] = [];

  constructor(userDataDir: string, private crypter: Crypter = plainCrypter) {
    this.identityFile = join(userDataDir, "peer-identity.json");
    this.settingsFile = join(userDataDir, "peer-settings.json");
    this.pairedFile = join(userDataDir, "peer-paired.json");
    this.knownFile = join(userDataDir, "peer-known.json");
    this.tlsKeyFile = join(userDataDir, "peer-tls-key.pem");
    this.tlsCertFile = join(userDataDir, "peer-tls-cert.pem");

    this.identity = this.readJson<PeerIdentity>(this.identityFile) ?? { peerId: generatePeerId(), name: defaultName() };
    if (!this.identity.peerId) this.identity.peerId = generatePeerId();
    if (!this.identity.name) this.identity.name = defaultName();
    this.writeJson(this.identityFile, this.identity);

    const s = this.readJson<Partial<PeerSettings>>(this.settingsFile) ?? {};
    this.settings = {
      enabled: s.enabled === true,
      port: Number.isInteger(s.port) && (s.port as number) > 0 ? (s.port as number) : DEFAULT_SERVER_PORT,
      name: typeof s.name === "string" && s.name.trim() ? s.name.trim() : this.identity.name,
      readOnly: s.readOnly === true,
      push: s.push === true,
    };

    this.paired = (this.readJson<PairedDevice[]>(this.pairedFile) ?? []).filter(
      (d) => d && typeof d.peerId === "string" && typeof d.tokenHash === "string",
    );
    this.known = this.readEncrypted().filter((p) => typeof p.certPem === "string" && p.certPem.includes("CERTIFICATE"));
  }

  // ── TLS identity (host side) ────────────────────────────────────────
  // Generated on first use, kept for ~10 years. The private key is written
  // with owner-only permissions; the cert is public (clients pin it).
  getTls(): TlsIdentity {
    if (this.tls) return this.tls;
    try {
      if (fs.existsSync(this.tlsKeyFile) && fs.existsSync(this.tlsCertFile)) {
        const keyPem = fs.readFileSync(this.tlsKeyFile, "utf8");
        const certPem = fs.readFileSync(this.tlsCertFile, "utf8");
        if (validateIdentity({ keyPem, certPem })) {
          this.tls = { keyPem, certPem, fingerprint: certFingerprint(certPem) };
          return this.tls;
        }
        console.error("peer-store: stored TLS identity invalid — regenerating");
      }
    } catch (e) {
      console.error("peer-store: failed to read TLS identity", e);
    }
    this.tls = generateSelfSigned(`Git Gud peer ${this.identity.peerId.slice(0, 8)}`);
    try {
      fs.writeFileSync(this.tlsKeyFile, this.tls.keyPem, { mode: 0o600 });
      fs.writeFileSync(this.tlsCertFile, this.tls.certPem);
    } catch (e) {
      console.error("peer-store: failed to persist TLS identity", e);
    }
    return this.tls;
  }

  // ── Identity / settings ─────────────────────────────────────────────

  getIdentity(): PeerIdentity {
    return { peerId: this.identity.peerId, name: this.settings.name };
  }

  getSettings(): PeerSettings {
    return { ...this.settings };
  }

  updateSettings(patch: Partial<PeerSettings>): PeerSettings {
    if (typeof patch.enabled === "boolean") this.settings.enabled = patch.enabled;
    if (typeof patch.readOnly === "boolean") this.settings.readOnly = patch.readOnly;
    if (typeof patch.port === "number" && Number.isInteger(patch.port) && patch.port >= 1024 && patch.port <= 65535) {
      this.settings.port = patch.port;
    }
    if (typeof patch.name === "string" && patch.name.trim()) this.settings.name = patch.name.trim().slice(0, 64);
    this.writeJson(this.settingsFile, this.settings);
    return this.getSettings();
  }

  // ── Devices paired to me (host side) ────────────────────────────────

  listPaired(): PairedDevice[] {
    return this.paired.map((d) => ({ ...d }));
  }

  addPaired(peerId: string, name: string, token: string, opts: { readOnly?: boolean; kind?: PairedDevice["kind"]; ttlMs?: number } = {}): PairedDevice {
    // Re-pairing the same device replaces its old token but keeps an explicit
    // read-only choice the user made for it earlier.
    const prev = this.paired.find((d) => d.peerId === peerId);
    this.paired = this.paired.filter((d) => d.peerId !== peerId);
    const dev: PairedDevice = {
      peerId,
      name: name.slice(0, 64),
      tokenHash: hashToken(token),
      createdAt: Date.now(),
      kind: opts.kind ?? prev?.kind ?? "desktop",
      readOnly: prev?.readOnly ?? opts.readOnly ?? false,
      ...(opts.ttlMs ? { expiresAt: Date.now() + opts.ttlMs } : {}),
    };
    this.paired.push(dev);
    this.writeJson(this.pairedFile, this.paired);
    return { ...dev };
  }

  setPairedPush(peerId: string, push: { token: string; events: string[] } | null): boolean {
    const d = this.paired.find((x) => x.peerId === peerId);
    if (!d) return false;
    if (push) d.push = push; else delete d.push;
    this.writeJson(this.pairedFile, this.paired);
    return true;
  }

  setPairedReadOnly(peerId: string, readOnly: boolean): boolean {
    const d = this.paired.find((x) => x.peerId === peerId);
    if (!d) return false;
    d.readOnly = readOnly;
    this.writeJson(this.pairedFile, this.paired);
    return true;
  }

  touchPaired(peerId: string): void {
    const d = this.paired.find((x) => x.peerId === peerId);
    if (!d) return;
    // Throttle disk writes: once a minute is plenty for "last seen".
    if (d.lastSeenAt && Date.now() - d.lastSeenAt < 60_000) { d.lastSeenAt = Date.now(); return; }
    d.lastSeenAt = Date.now();
    this.writeJson(this.pairedFile, this.paired);
  }

  revokePaired(peerId: string): boolean {
    const before = this.paired.length;
    this.paired = this.paired.filter((d) => d.peerId !== peerId);
    if (this.paired.length !== before) this.writeJson(this.pairedFile, this.paired);
    return this.paired.length !== before;
  }

  findByToken(token: string): PairedDevice | null {
    const h = hashToken(token);
    // Hash comparison is already constant-length; a plain compare of hex
    // digests leaks nothing useful about the token.
    const d = this.paired.find((x) => x.tokenHash === h) ?? null;
    if (d?.expiresAt && Date.now() > d.expiresAt) return null; // expired → 401 → client re-pairs
    return d;
  }

  // Replace a device's token in place (authenticated __rotateToken). Keeps
  // read-only/kind/push; extends expiry by the same TTL if one was set.
  rotatePairedToken(peerId: string, newToken: string, ttlMs?: number): PairedDevice | null {
    const d = this.paired.find((x) => x.peerId === peerId);
    if (!d) return null;
    d.tokenHash = hashToken(newToken);
    if (ttlMs) d.expiresAt = Date.now() + ttlMs; else delete d.expiresAt;
    this.writeJson(this.pairedFile, this.paired);
    return { ...d };
  }

  // New TLS identity: every paired device must re-pair (their pin breaks).
  rotateTls(): TlsIdentity {
    for (const f of [this.tlsKeyFile, this.tlsCertFile]) { try { fs.unlinkSync(f); } catch { /* absent */ } }
    this.tls = null;
    return this.getTls();
  }

  // ── Peers I connect to (client side) ────────────────────────────────

  listKnown(): KnownPeer[] {
    return this.known.map((p) => ({ ...p }));
  }

  getKnown(peerId: string): KnownPeer | null {
    const p = this.known.find((k) => k.peerId === peerId);
    return p ? { ...p } : null;
  }

  upsertKnown(peer: Omit<KnownPeer, "pairedAt">): KnownPeer {
    this.known = this.known.filter((k) => k.peerId !== peer.peerId);
    const full: KnownPeer = { ...peer, pairedAt: Date.now() };
    this.known.push(full);
    this.writeEncrypted();
    return { ...full };
  }

  // Client side: the host rotated our token.
  setKnownToken(peerId: string, token: string, expiresAt?: number): void {
    const p = this.known.find((k) => k.peerId === peerId);
    if (!p) return;
    p.token = token;
    p.tokenExpiresAt = expiresAt;
    this.writeEncrypted();
  }

  // Address/name refresh from discovery — token untouched.
  touchKnown(peerId: string, patch: { host?: string; port?: number; name?: string }): void {
    const p = this.known.find((k) => k.peerId === peerId);
    if (!p) return;
    let changed = false;
    if (patch.host && patch.host !== p.host) { p.host = patch.host; changed = true; }
    if (patch.port && patch.port !== p.port) { p.port = patch.port; changed = true; }
    if (patch.name && patch.name !== p.name) { p.name = patch.name; changed = true; }
    if (changed) this.writeEncrypted();
  }

  forgetKnown(peerId: string): boolean {
    const before = this.known.length;
    this.known = this.known.filter((k) => k.peerId !== peerId);
    if (this.known.length !== before) this.writeEncrypted();
    return this.known.length !== before;
  }

  // ── IO ──────────────────────────────────────────────────────────────

  private readJson<T>(file: string): T | null {
    try {
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, "utf8")) as T;
    } catch (e) {
      console.error(`peer-store: failed to read ${file}`, e);
      return null;
    }
  }

  private writeJson(file: string, value: unknown): void {
    try {
      fs.writeFileSync(file, JSON.stringify(value, null, 2));
    } catch (e) {
      console.error(`peer-store: failed to write ${file}`, e);
    }
  }

  private readEncrypted(): KnownPeer[] {
    try {
      if (!fs.existsSync(this.knownFile)) return [];
      const raw = fs.readFileSync(this.knownFile);
      const parsed = JSON.parse(this.crypter.decrypt(raw));
      return Array.isArray(parsed)
        ? parsed.filter((p) => p && typeof p.peerId === "string" && typeof p.token === "string" && typeof p.host === "string")
        : [];
    } catch (e) {
      console.error("peer-store: failed to read known peers", e);
      return [];
    }
  }

  private writeEncrypted(): void {
    try {
      fs.writeFileSync(this.knownFile, this.crypter.encrypt(JSON.stringify(this.known)));
    } catch (e) {
      console.error("peer-store: failed to write known peers", e);
    }
  }
}

function defaultName(): string {
  try {
    return hostname().replace(/\.local$/i, "").slice(0, 64) || "Git Gud";
  } catch {
    return "Git Gud";
  }
}
