// Relay transport for peers that cannot reach each other directly.
//
//   relayDial()  — client side: get a raw socket spliced to a host (then the
//                  caller runs the pinned TLS handshake over it)
//   RelayLink    — host side: keep a control connection registered at the
//                  relay; on "incoming", dial back and hand the spliced socket
//                  to the local https server as if it had been accepted.
import * as net from "net";
import * as tls from "tls";
import { createHash } from "crypto";
import { EventEmitter } from "events";
import {
  RELAY_ACCEPT_TIMEOUT_MS, RELAY_KEEPALIVE_MS, encodeRelayFrame, parseRelayFrame, parseRelayUrl, type RelayFrame,
} from "./peer-protocol";

export function fingerprintHash(fingerprint: string): string {
  return createHash("sha256").update(fingerprint.replace(/:/g, "").toUpperCase(), "utf8").digest("hex");
}

export interface RelayTarget { host: string; port: number; fingerprint?: string }

// TLS to the relay. The relay's cert is pinned when its fingerprint is known
// (from the QR / config), otherwise accepted as-is: the relay only ever sees
// ciphertext of the inner, pinned host connection.
function connectRelay(r: RelayTarget, timeoutMs = 8_000): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({
      host: r.host, port: r.port, minVersion: "TLSv1.2", rejectUnauthorized: false, servername: r.host,
      checkServerIdentity: () => undefined,
    });
    const t = setTimeout(() => { sock.destroy(); reject(new Error(`relay ${r.host}:${r.port} timed out`)); }, timeoutMs);
    sock.once("secureConnect", () => {
      clearTimeout(t);
      if (r.fingerprint) {
        const got = sock.getPeerCertificate().fingerprint256.replace(/:/g, "").toUpperCase();
        if (got !== r.fingerprint) { sock.destroy(); reject(new Error("relay certificate does not match its fingerprint")); return; }
      }
      resolve(sock);
    });
    sock.once("error", (e) => { clearTimeout(t); reject(e); });
  });
}

// Read newline-delimited JSON frames until `until` returns true; leftover
// bytes after the last consumed frame are returned (start of raw stream).
function readFrames(sock: net.Socket, onFrame: (f: RelayFrame) => boolean, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const t = setTimeout(() => { cleanup(); reject(new Error("relay handshake timed out")); }, timeoutMs);
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      let nl: number;
      while ((nl = buf.indexOf(0x0a)) >= 0) {
        const line = buf.subarray(0, nl).toString("utf8");
        buf = buf.subarray(nl + 1);
        const f = parseRelayFrame(line);
        if (f && onFrame(f)) { cleanup(); resolve(Buffer.from(buf)); return; }
      }
    };
    const onErr = (e: Error) => { cleanup(); reject(e); };
    const onEnd = () => { cleanup(); reject(new Error("relay closed the connection")); };
    const cleanup = () => { clearTimeout(t); sock.off("data", onData); sock.off("error", onErr); sock.off("end", onEnd); };
    sock.on("data", onData); sock.once("error", onErr); sock.once("end", onEnd);
  });
}

// Client: returns a socket already spliced to the host. Any bytes the relay
// delivered after "ok" are re-emitted so the TLS layer sees them.
export async function relayDial(relayUrl: string, peerId: string, hostFingerprint: string): Promise<net.Socket> {
  const r = parseRelayUrl(relayUrl);
  if (!r) throw new Error(`Bad relay address: ${relayUrl}`);
  const sock = await connectRelay(r);
  sock.write(encodeRelayFrame({ t: "connect", peerId, fph: fingerprintHash(hostFingerprint) }));
  let err = "";
  const rest = await readFrames(sock, (f) => { if (f.t === "ok") return true; if (f.t === "error") { err = f.error; return true; } return false; }, RELAY_ACCEPT_TIMEOUT_MS + 5_000);
  if (err) { sock.destroy(); throw new Error(`relay: ${err}`); }
  if (rest.length) sock.unshift(rest);
  return sock;
}

// Host: registration + accept loop.
export interface RelayLinkOpts {
  relayUrl: string;
  peerId: string;
  token: string;
  name: string;
  fingerprint: () => string;      // this host's TLS cert fingerprint
  onSocket: (sock: net.Socket) => void; // hand off to the https server
  log?: (msg: string) => void;
}

export class RelayLink extends EventEmitter {
  status: "offline" | "connecting" | "registered" = "offline";
  lastError = "";
  private ctl: tls.TLSSocket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private ping: NodeJS.Timeout | null = null;
  private backoff = 1_000;
  private want = false;

  constructor(private o: RelayLinkOpts) { super(); }

  start(): void { this.want = true; this.open(); }

  stop(): void {
    this.want = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.ping) { clearInterval(this.ping); this.ping = null; }
    this.ctl?.destroy(); this.ctl = null;
    this.set("offline", "");
  }

  private set(s: RelayLink["status"], err: string): void {
    if (s === this.status && err === this.lastError) return;
    this.status = s; this.lastError = err; this.emit("status", s);
  }

  private async open(): Promise<void> {
    if (!this.want) return;
    this.set("connecting", "");
    const r = parseRelayUrl(this.o.relayUrl);
    if (!r) { this.set("offline", `bad relay address ${this.o.relayUrl}`); return; }
    try {
      const sock = await connectRelay(r);
      this.ctl = sock;
      sock.write(encodeRelayFrame({ t: "register", peerId: this.o.peerId, token: this.o.token, fph: fingerprintHash(this.o.fingerprint()), name: this.o.name }));
      let buf = "";
      sock.setEncoding("utf8");
      sock.on("data", (d: string) => {
        buf += d;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const f = parseRelayFrame(buf.slice(0, nl)); buf = buf.slice(nl + 1);
          if (!f) continue;
          if (f.t === "registered") { this.backoff = 1_000; this.set("registered", ""); }
          else if (f.t === "error") { this.set("offline", f.error); sock.destroy(); }
          else if (f.t === "incoming") this.accept(r, f.conn).catch((e) => this.o.log?.(`relay accept failed: ${String(e)}`));
          else if (f.t === "pong") { /* alive */ }
        }
      });
      this.ping = setInterval(() => { try { sock.write(encodeRelayFrame({ t: "ping" })); } catch { /* closing */ } }, RELAY_KEEPALIVE_MS);
      const fail = (why: string) => {
        if (this.ping) { clearInterval(this.ping); this.ping = null; }
        if (this.ctl !== sock) return;
        this.ctl = null;
        if (!this.want) return;
        this.set("offline", why);
        this.timer = setTimeout(() => { this.timer = null; this.open(); }, this.backoff);
        this.backoff = Math.min(30_000, this.backoff * 2);
      };
      sock.once("close", () => fail(this.lastError || "relay connection closed"));
      sock.once("error", (e) => fail(e.message));
    } catch (e) {
      this.set("offline", String((e as Error).message ?? e));
      if (this.want) { this.timer = setTimeout(() => { this.timer = null; this.open(); }, this.backoff); this.backoff = Math.min(30_000, this.backoff * 2); }
    }
  }

  // Dial back for one client: a fresh connection the relay splices, then the
  // local https server treats it like an accepted socket (TLS handshake and
  // all — the client pins OUR certificate through the relay).
  private async accept(r: RelayTarget, conn: string): Promise<void> {
    const sock = await connectRelay(r);
    sock.write(encodeRelayFrame({ t: "accept", conn, peerId: this.o.peerId, token: this.o.token }));
    let err = "";
    const rest = await readFrames(sock, (f) => { if (f.t === "ok") return true; if (f.t === "error") { err = f.error; return true; } return false; }, RELAY_ACCEPT_TIMEOUT_MS);
    if (err) { sock.destroy(); throw new Error(err); }
    if (rest.length) sock.unshift(rest);
    this.o.onSocket(sock);
  }
}
