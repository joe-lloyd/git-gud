#!/usr/bin/env node
// gitgud-relay — rendezvous + relay for Git Gud peers behind NATs.
//
// Zero dependencies. One listener, two kinds of client:
//
//  • Frame clients (hosts, desktop Git Gud): TLS to the relay, then newline
//    JSON frames. Hosts register (peerId + token + sha256(fingerprint)) and
//    keep the connection as their control channel; clients ask for a peerId +
//    fingerprint hash; the relay tells the host to dial back and splices.
//  • SNI clients (phone, anything that just speaks HTTPS): a plain TLS
//    ClientHello whose server_name is `<peerId>.<anything>`. The relay reads
//    the SNI *without* terminating TLS, asks the host to dial back and pipes
//    the untouched ClientHello + everything after it to the host. The TLS
//    session is therefore the host's own certificate, pinned by the client.
//
// Either way the relay never sees plaintext: the host's pinned TLS runs end
// to end through the splice.
//
//   gitgud-relay [--port 47833] [--bind 0.0.0.0] [--data ~/.local/share/gitgud-relay] [--json]
//
// Host tokens: first registration of a peerId binds its token (persisted);
// later registrations must present the same token. `gitgud-relay tokens`
// lists / `gitgud-relay forget <peerId>` unbinds.
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as tls from "tls";
import { join } from "path";
import { RELAY_ACCEPT_TIMEOUT_MS, RELAY_DEFAULT_PORT, encodeRelayFrame, parseRelayFrame, type RelayFrame } from "@gitgud/peer-protocol";
import { generateSelfSigned, validateIdentity, certFingerprint } from "../main/peer-tls";

declare const __RELAY_VERSION__: string | undefined;
const VERSION = typeof __RELAY_VERSION__ === "string" ? __RELAY_VERSION__ : "0.0.0-dev";

type Host = { peerId: string; name: string; fph: string; sock: tls.TLSSocket; since: number };
// `raw`: SNI client — no relay frames on its side; `rest` is its ClientHello.
type Pending = { client: net.Socket; peerId: string; timer: NodeJS.Timeout; rest: Buffer; raw: boolean };

/**
 * Extract server_name from a TLS ClientHello. Returns:
 *   string  – the SNI host name
 *   null    – complete ClientHello without SNI, or not a TLS handshake
 *   "more"  – need more bytes (record not complete yet)
 */
export function parseClientHelloSni(buf: Buffer): string | null | "more" {
  if (buf.length < 5) return "more";
  if (buf[0] !== 0x16 || buf[1] !== 0x03) return null; // not a TLS handshake record
  const recLen = buf.readUInt16BE(3);
  if (buf.length < 5 + recLen) return "more";
  const hs = buf.subarray(5, 5 + recLen);
  if (hs.length < 4 || hs[0] !== 0x01) return null; // not ClientHello
  let o = 4 + 2 + 32; // handshake header, client_version, random
  if (hs.length < o + 1) return null;
  o += 1 + hs[o]; // session id
  if (hs.length < o + 2) return null;
  o += 2 + hs.readUInt16BE(o); // cipher suites
  if (hs.length < o + 1) return null;
  o += 1 + hs[o]; // compression methods
  if (hs.length < o + 2) return null;
  const extEnd = o + 2 + hs.readUInt16BE(o); o += 2;
  while (o + 4 <= Math.min(extEnd, hs.length)) {
    const type = hs.readUInt16BE(o), len = hs.readUInt16BE(o + 2); o += 4;
    if (type === 0 && o + 2 <= hs.length) {
      let p = o + 2; // skip server_name_list length
      const end = Math.min(o + len, hs.length);
      while (p + 3 <= end) {
        const nameType = hs[p], nameLen = hs.readUInt16BE(p + 1); p += 3;
        if (nameType === 0 && p + nameLen <= end) return hs.subarray(p, p + nameLen).toString("latin1").toLowerCase();
        p += nameLen;
      }
      return null;
    }
    o += len;
  }
  return null;
}

/** `<peerId>.anything` → peerId (hex, 8–64 chars); anything else → null. */
export function peerIdFromSni(sni: string | null): string | null {
  if (!sni) return null;
  const label = sni.split(".")[0];
  return /^[0-9a-f]{8,64}$/.test(label) ? label : null;
}

export interface RelayOptions { port: number; bind: string; dataDir: string; log?: (m: string, f?: Record<string, unknown>) => void }

export class RelayServer {
  private server: net.Server | null = null;
  // Not listening: terminates relay-TLS for frame clients after the SNI peek.
  private tlsServer: tls.Server | null = null;
  private hosts = new Map<string, Host>();      // peerId → registered host
  private pending = new Map<string, Pending>(); // conn id → waiting client
  private tokens: Record<string, string> = {};  // peerId → bound token
  private seq = 0;
  fingerprint = "";
  stats = { splices: 0, bytes: 0 };

  constructor(private o: RelayOptions) {}

  private log(m: string, f?: Record<string, unknown>): void { this.o.log?.(m, f); }

  async start(): Promise<number> {
    fs.mkdirSync(this.o.dataDir, { recursive: true, mode: 0o700 });
    const keyFile = join(this.o.dataDir, "relay-tls-key.pem"), certFile = join(this.o.dataDir, "relay-tls-cert.pem"), tokFile = join(this.o.dataDir, "relay-hosts.json");
    let key = "", cert = "";
    try { key = fs.readFileSync(keyFile, "utf8"); cert = fs.readFileSync(certFile, "utf8"); } catch { /* generate */ }
    if (!key || !cert || !validateIdentity({ keyPem: key, certPem: cert })) {
      const id = generateSelfSigned(`gitgud-relay ${os.hostname()}`);
      key = id.keyPem; cert = id.certPem;
      fs.writeFileSync(keyFile, key, { mode: 0o600 }); fs.writeFileSync(certFile, cert, { mode: 0o644 });
    }
    this.fingerprint = certFingerprint(cert);
    try { this.tokens = JSON.parse(fs.readFileSync(tokFile, "utf8")); } catch { this.tokens = {}; }
    this.saveTokens = () => fs.writeFileSync(tokFile, JSON.stringify(this.tokens, null, 2), { mode: 0o600 });

    this.tlsServer = tls.createServer({ key, cert, minVersion: "TLSv1.2" }, (sock) => this.onConnection(sock));
    this.tlsServer.on("tlsClientError", () => { /* handshake failed — client gone */ });

    return new Promise((resolve, reject) => {
      const srv = net.createServer((sock) => this.onRawConnection(sock));
      srv.on("error", reject);
      srv.listen(this.o.port, this.o.bind, () => { srv.removeListener("error", reject); this.server = srv; resolve((srv.address() as net.AddressInfo).port); });
    });
  }

  // Peek the ClientHello. SNI naming a registered host → passthrough splice
  // (the client is speaking TLS to the *host*, not to us). Anything else →
  // terminate TLS here and expect relay frames.
  private onRawConnection(sock: net.Socket): void {
    let buf = Buffer.alloc(0);
    const remote = sock.remoteAddress ?? "";
    const idle = setTimeout(() => sock.destroy(), 10_000);
    const done = () => { clearTimeout(idle); sock.off("data", onData); };
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const sni = parseClientHelloSni(buf);
      if (sni === "more") { if (buf.length > 16_384) { done(); sock.destroy(); } return; }
      done();
      sock.pause();
      const peerId = peerIdFromSni(sni);
      if (peerId && this.hosts.has(peerId)) return this.connectRaw(sock, peerId, buf, remote);
      // Relay-TLS (frames): give the consumed bytes back and let a tls.Server
      // take the socket over exactly as if it had accepted it (the pause
      // before unshift matters — a flowing socket loses the buffer).
      sock.unshift(buf);
      this.tlsServer!.emit("connection", sock);
    };
    sock.on("data", onData);
    sock.on("error", () => { /* peer went away */ });
  }

  private connectRaw(sock: net.Socket, peerId: string, clientHello: Buffer, remote: string): void {
    const host = this.hosts.get(peerId)!;
    const conn = `${Date.now().toString(36)}-${++this.seq}`;
    const timer = setTimeout(() => { this.pending.delete(conn); sock.destroy(); }, RELAY_ACCEPT_TIMEOUT_MS);
    this.pending.set(conn, { client: sock, peerId, timer, rest: clientHello, raw: true });
    sock.once("close", () => { const p = this.pending.get(conn); if (p) { clearTimeout(p.timer); this.pending.delete(conn); } });
    host.sock.write(encodeRelayFrame({ t: "incoming", conn }));
    this.log("sni connect", { peerId8: peerId.slice(0, 8), remote });
  }
  private saveTokens: () => void = () => {};

  stop(): void {
    for (const h of this.hosts.values()) h.sock.destroy();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.client.destroy(); }
    this.hosts.clear(); this.pending.clear();
    this.server?.close(); this.server = null;
    this.tlsServer?.close(); this.tlsServer = null;
  }

  listHosts(): Array<{ peerId: string; name: string; since: number }> {
    return [...this.hosts.values()].map((h) => ({ peerId: h.peerId, name: h.name, since: h.since }));
  }

  private onConnection(sock: tls.TLSSocket): void {
    // Unauthenticated sockets get 10 s to say something useful.
    let buf = Buffer.alloc(0);
    const idle = setTimeout(() => sock.destroy(), 10_000);
    const remote = sock.remoteAddress ?? "";
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const nl = buf.indexOf(0x0a);
      if (nl < 0) { if (buf.length > 4096) sock.destroy(); return; }
      clearTimeout(idle);
      sock.off("data", onData);
      const frame = parseRelayFrame(buf.subarray(0, nl).toString("utf8"));
      const rest = Buffer.from(buf.subarray(nl + 1));
      if (!frame) { sock.end(encodeRelayFrame({ t: "error", error: "bad frame" })); return; }
      this.dispatch(sock, frame, rest, remote);
    };
    sock.on("data", onData);
    sock.on("error", () => { /* peer went away */ });
  }

  private dispatch(sock: tls.TLSSocket, f: RelayFrame, rest: Buffer, remote: string): void {
    switch (f.t) {
      case "register": return this.register(sock, f, remote);
      case "connect": return this.connectClient(sock, f, rest, remote);
      case "accept": return this.acceptHost(sock, f, rest);
      case "ping": sock.write(encodeRelayFrame({ t: "pong" })); return;
      default: sock.end(encodeRelayFrame({ t: "error", error: `unexpected ${f.t}` }));
    }
  }

  private authHost(peerId: string, token: string): boolean {
    if (!/^[0-9a-f]{8,64}$/.test(peerId) || !/^[0-9a-f]{32,128}$/.test(token)) return false;
    const bound = this.tokens[peerId];
    if (!bound) { this.tokens[peerId] = token; this.saveTokens(); return true; } // first registration binds
    return bound === token;
  }

  private register(sock: tls.TLSSocket, f: Extract<RelayFrame, { t: "register" }>, remote: string): void {
    if (!this.authHost(f.peerId, f.token) || !/^[0-9a-f]{64}$/.test(f.fph)) {
      this.log("register refused", { peerId8: f.peerId.slice(0, 8), remote });
      sock.end(encodeRelayFrame({ t: "error", error: "registration refused" }));
      return;
    }
    this.hosts.get(f.peerId)?.sock.destroy(); // last registration wins
    const host: Host = { peerId: f.peerId, name: String(f.name ?? "").slice(0, 64), fph: f.fph, sock, since: Date.now() };
    this.hosts.set(f.peerId, host);
    sock.write(encodeRelayFrame({ t: "registered" }));
    this.log("host registered", { peerId8: f.peerId.slice(0, 8), name: host.name, remote });
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", (d: string) => {
      buf += d;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const fr = parseRelayFrame(buf.slice(0, nl)); buf = buf.slice(nl + 1);
        if (fr?.t === "ping") sock.write(encodeRelayFrame({ t: "pong" }));
      }
    });
    sock.on("close", () => { if (this.hosts.get(f.peerId)?.sock === sock) { this.hosts.delete(f.peerId); this.log("host gone", { peerId8: f.peerId.slice(0, 8) }); } });
  }

  private connectClient(sock: tls.TLSSocket, f: Extract<RelayFrame, { t: "connect" }>, rest: Buffer, remote: string): void {
    const host = this.hosts.get(f.peerId);
    // Same answer whether the host is unknown or the hash is wrong: no enumeration.
    if (!host || host.fph !== f.fph) {
      this.log("connect refused", { peerId8: String(f.peerId).slice(0, 8), remote });
      sock.end(encodeRelayFrame({ t: "error", error: "no such host" }));
      return;
    }
    const conn = `${Date.now().toString(36)}-${++this.seq}`;
    const timer = setTimeout(() => {
      this.pending.delete(conn);
      sock.end(encodeRelayFrame({ t: "error", error: "host did not accept in time" }));
    }, RELAY_ACCEPT_TIMEOUT_MS);
    this.pending.set(conn, { client: sock, peerId: f.peerId, timer, rest, raw: false });
    sock.pause();
    sock.once("close", () => { const p = this.pending.get(conn); if (p) { clearTimeout(p.timer); this.pending.delete(conn); } });
    host.sock.write(encodeRelayFrame({ t: "incoming", conn }));
  }

  private acceptHost(sock: tls.TLSSocket, f: Extract<RelayFrame, { t: "accept" }>, rest: Buffer): void {
    const p = this.pending.get(f.conn);
    if (!p || p.peerId !== f.peerId || this.tokens[f.peerId] !== f.token) {
      sock.end(encodeRelayFrame({ t: "error", error: "unknown connection" }));
      return;
    }
    clearTimeout(p.timer);
    this.pending.delete(f.conn);
    // Host gets "ok"; a frame client gets "ok" too, an SNI client gets nothing
    // but its own TLS session with the host. Then bytes flow untouched.
    sock.write(encodeRelayFrame({ t: "ok" }));
    if (!p.raw) p.client.write(encodeRelayFrame({ t: "ok" }));
    if (p.rest.length) sock.write(p.rest);
    if (rest.length) p.client.write(rest);
    this.splice(p.client, sock);
    this.stats.splices++;
    this.log("spliced", { peerId8: f.peerId.slice(0, 8), sni: p.raw });
  }

  private splice(a: net.Socket, b: net.Socket): void {
    const count = (d: Buffer) => { this.stats.bytes += d.length; };
    a.on("data", count); b.on("data", count);
    a.pipe(b); b.pipe(a);
    a.resume();
    const close = () => { a.destroy(); b.destroy(); };
    a.on("close", close); b.on("close", close);
    a.on("error", close); b.on("error", close);
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────
function flag(args: string[], name: string): string | undefined { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

async function main(argv: string[]): Promise<void> {
  const dataDir = flag(argv, "--data") ?? join(process.env.XDG_DATA_HOME || join(os.homedir(), ".local", "share"), "gitgud-relay");
  if (argv[0] === "--version" || argv[0] === "-v") { process.stdout.write(VERSION + "\n"); return; }
  if (argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(`gitgud-relay ${VERSION}\n\n  gitgud-relay [--port ${RELAY_DEFAULT_PORT}] [--bind 0.0.0.0] [--data DIR] [--json]\n  gitgud-relay tokens [--data DIR]        list host peer ids bound to this relay\n  gitgud-relay forget <peerId> [--data DIR]\n\nHosts point at it with  relay://HOST:PORT#<fingerprint>  (fingerprint printed at start).\n`);
    return;
  }
  if (argv[0] === "tokens") {
    try { const t = JSON.parse(fs.readFileSync(join(dataDir, "relay-hosts.json"), "utf8")) as Record<string, string>; for (const k of Object.keys(t)) process.stdout.write(`${k}\n`); } catch { process.stdout.write("no hosts bound\n"); }
    return;
  }
  if (argv[0] === "forget") {
    const f = join(dataDir, "relay-hosts.json");
    const t = JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, string>;
    delete t[argv[1] ?? ""]; fs.writeFileSync(f, JSON.stringify(t, null, 2)); process.stdout.write("ok\n");
    return;
  }
  const json = argv.includes("--json");
  const log = (m: string, f?: Record<string, unknown>) => process.stdout.write(json ? JSON.stringify({ ts: new Date().toISOString(), msg: m, ...(f ?? {}) }) + "\n" : `${new Date().toISOString()} ${m}${f ? " " + Object.entries(f).map(([k, v]) => `${k}=${String(v)}`).join(" ") : ""}\n`);
  const relay = new RelayServer({ port: Number(flag(argv, "--port") ?? RELAY_DEFAULT_PORT), bind: flag(argv, "--bind") ?? "0.0.0.0", dataDir, log });
  const port = await relay.start();
  log("relay listening", { port, fingerprint: relay.fingerprint, address: `relay://${os.hostname()}:${port}#${relay.fingerprint.replace(/:/g, "")}` });
  const stop = () => { relay.stop(); process.exit(0); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  setInterval(() => log("stats", { hosts: relay.listHosts().length, splices: relay.stats.splices, mb: (relay.stats.bytes / 1e6).toFixed(1) }), 300_000);
}

if (require.main === module || process.argv[1]?.endsWith("relay/main.js") || process.argv[1]?.endsWith("gitgud-relay")) {
  main(process.argv.slice(2)).catch((e) => { process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
}
