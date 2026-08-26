// Local control channel: a Unix socket the CLI talks to while the daemon
// runs (`gitgud-headless pair|status|devices|revoke|reload`). One JSON
// request per line, one JSON reply per line. Only the same user can reach it
// (socket dir is 0700).
import * as net from "net";
import * as fs from "fs";

export type ControlRequest =
  | { cmd: "status" }
  | { cmd: "pair"; qr?: boolean }
  | { cmd: "devices" }
  | { cmd: "revoke"; peerId: string }
  | { cmd: "reload" }
  | { cmd: "stop" };

export type ControlHandler = (req: ControlRequest) => Promise<unknown>;

export function startControlServer(socketPath: string, handler: ControlHandler): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    try { fs.unlinkSync(socketPath); } catch { /* stale or absent */ }
    const srv = net.createServer((sock) => {
      let buf = "";
      sock.setEncoding("utf8");
      sock.on("data", async (chunk: string) => {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let req: ControlRequest | null = null;
          try { req = JSON.parse(line) as ControlRequest; } catch { /* below */ }
          if (!req || typeof req.cmd !== "string") { sock.write(JSON.stringify({ ok: false, error: "bad request" }) + "\n"); continue; }
          try {
            const result = await handler(req);
            sock.write(JSON.stringify({ ok: true, result }) + "\n");
          } catch (e) {
            sock.write(JSON.stringify({ ok: false, error: String(e instanceof Error ? e.message : e) }) + "\n");
          }
        }
      });
      sock.on("error", () => { /* client went away */ });
    });
    srv.on("error", reject);
    srv.listen(socketPath, () => {
      try { fs.chmodSync(socketPath, 0o600); } catch { /* non-POSIX */ }
      srv.removeListener("error", reject);
      resolve(srv);
    });
  });
}

export function controlRequest(socketPath: string, req: ControlRequest, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath);
    let buf = "";
    const t = setTimeout(() => { sock.destroy(); reject(new Error("control: timeout")); }, timeoutMs);
    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(JSON.stringify(req) + "\n"));
    sock.on("data", (d: string) => {
      buf += d;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      clearTimeout(t);
      sock.end();
      try {
        const r = JSON.parse(buf.slice(0, nl)) as { ok: boolean; result?: unknown; error?: string };
        r.ok ? resolve(r.result) : reject(new Error(r.error ?? "control: error"));
      } catch (e) { reject(e); }
    });
    sock.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(t);
      reject(e.code === "ENOENT" || e.code === "ECONNREFUSED" ? new Error("gitgud-headless is not running (no control socket). Start it with: gitgud-headless serve") : e);
    });
  });
}
