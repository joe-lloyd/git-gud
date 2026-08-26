#!/usr/bin/env node
// gitgud-headless — Git Gud's peer host without a window.
//
//   gitgud-headless init              write a commented config.jsonc
//   gitgud-headless serve             run the daemon (systemd ExecStart)
//   gitgud-headless pair [--qr]       open a pairing window; prints code + fingerprint
//   gitgud-headless status | devices | revoke <peerId8|peerId> | reload | stop
//   gitgud-headless update [--channel stable|dev] [--check]
//   gitgud-headless audit [-n 50]
//
// Env: GITGUD_HEADLESS_HOME (all dirs under one folder), XDG_* honoured.
import * as fs from "fs";
import { join } from "path";
import { configPath, ensureDirs, loadConfig, renderDefaultConfig, resolvePaths } from "./config";
import { controlRequest } from "./control";
import { createLogger } from "./log";
import { startDaemon } from "./daemon";
import { AuditLog } from "./audit";
import { selfUpdate } from "./update";
import { renderQrAscii } from "../main/qr";
import { pairingQrPayload } from "../main/peer-protocol";

declare const __HEADLESS_VERSION__: string | undefined;
const VERSION = typeof __HEADLESS_VERSION__ === "string" ? __HEADLESS_VERSION__ : (process.env.GITGUD_HEADLESS_VERSION || "0.0.0-dev");

function usage(): string {
  return `gitgud-headless ${VERSION} — Git Gud peer host without a window

Usage:
  gitgud-headless init [--writable] [--bind <ip|iface>] [--repo <path>]...
  gitgud-headless serve [--json]
  gitgud-headless pair [--qr]
  gitgud-headless status
  gitgud-headless devices
  gitgud-headless revoke <peerId or first 8 chars>
  gitgud-headless reload | stop
  gitgud-headless audit [-n 50]
  gitgud-headless tls show | tls rotate --yes
  gitgud-headless update [--channel stable|dev] [--check]
  gitgud-headless --version | --help

Config: ${configPath(resolvePaths())}
Docs:   https://github.com/joe-lloyd/git-gud/blob/main/docs/headless.md
`;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function has(args: string[], name: string): boolean { return args.includes(name); }

async function main(argv: string[]): Promise<number> {
  const [cmd = "help", ...args] = argv;
  const paths = resolvePaths();
  const out = (s: string) => process.stdout.write(s + "\n");

  switch (cmd) {
    case "--version": case "-v": case "version": out(VERSION); return 0;
    case "--help": case "-h": case "help": out(usage()); return 0;

    case "init": {
      ensureDirs(paths);
      const file = configPath(paths);
      if (fs.existsSync(file) && !has(args, "--force")) { out(`config exists: ${file} (use --force to overwrite)`); return 1; }
      const repos: string[] = [];
      for (let i = 0; i < args.length; i++) if (args[i] === "--repo" && args[i + 1]) repos.push(args[++i]);
      fs.writeFileSync(file, renderDefaultConfig({ readOnly: !has(args, "--writable"), bind: flag(args, "--bind") ?? "127.0.0.1", repos }), { mode: 0o600 });
      out(`wrote ${file}\nnext: edit it, then \`gitgud-headless serve\` (or install the systemd unit — see docs/headless.md)`);
      return 0;
    }

    case "serve": {
      const log = createLogger({ json: has(args, "--json"), minLevel: has(args, "--debug") ? "debug" : "info" });
      let cfgOk = true;
      try { loadConfig(paths); } catch (e) { log.level("error", String(e)); cfgOk = false; }
      if (!cfgOk) return 2;
      const d = await startDaemon({ paths, version: VERSION, log });
      const shutdown = (sig: string) => { log(`received ${sig}`); d.stop().then(() => process.exit(0)); };
      process.on("SIGTERM", () => shutdown("SIGTERM"));
      process.on("SIGINT", () => shutdown("SIGINT"));
      process.on("SIGHUP", () => d.reload());
      return -1; // keep running
    }

    case "pair": {
      const r = (await controlRequest(join(paths.runtimeDir, "control.sock"), { cmd: "pair" })) as { code: string; fingerprint: string; expiresAt: number; addresses: string[]; relay?: string };
      const mins = Math.round((r.expiresAt - Date.now()) / 60000);
      out(`Pairing code:  ${r.code.slice(0, 3)} ${r.code.slice(3)}     (valid ${mins} min or until used)`);
      out(`Certificate:   ${r.fingerprint}`);
      out(`Connect from Git Gud → Peers → Connect by address → one of:`);
      for (const a of r.addresses) out(`               ${a}`);
      if (r.relay) out(`               ${r.relay}   (from anywhere, via relay — paste the payload below)`);
      const payload = pairingQrPayload({ host: r.addresses[0].split(":")[0], port: Number(r.addresses[0].split(":")[1]), fingerprint: r.fingerprint, code: r.code, alts: r.addresses.slice(1).map((a) => a.split(":")[0]), relay: r.relay });
      if (!has(args, "--qr")) out(`Payload (paste into Connect by address): ${payload}`);
      if (has(args, "--qr")) {
        out("");
        out(renderQrAscii(payload));
        out(`Scan with the Git Gud companion app. Payload: ${payload}`);
      }
      return 0;
    }

    case "status": {
      const s = (await controlRequest(join(paths.runtimeDir, "control.sock"), { cmd: "status" })) as Record<string, unknown>;
      out(JSON.stringify(s, null, 2));
      return 0;
    }
    case "devices": {
      const ds = (await controlRequest(join(paths.runtimeDir, "control.sock"), { cmd: "devices" })) as Array<{ peerId: string; name: string; kind: string; readOnly: boolean; createdAt: number; lastSeenAt: number | null }>;
      if (!ds.length) { out("no paired devices"); return 0; }
      for (const d of ds) out(`${d.peerId.slice(0, 8)}  ${d.name.padEnd(24)} ${d.kind.padEnd(10)} ${d.readOnly ? "read-only" : "writable "}  paired ${new Date(d.createdAt).toISOString().slice(0, 10)}${d.lastSeenAt ? `  seen ${new Date(d.lastSeenAt).toISOString().slice(0, 16)}` : ""}`);
      return 0;
    }
    case "revoke": {
      const id = args[0];
      if (!id) { out("usage: gitgud-headless revoke <peerId or first 8 chars>"); return 1; }
      const ds = (await controlRequest(join(paths.runtimeDir, "control.sock"), { cmd: "devices" })) as Array<{ peerId: string }>;
      const match = ds.filter((d) => d.peerId === id || d.peerId.startsWith(id));
      if (match.length !== 1) { out(match.length ? "ambiguous prefix" : "no such device"); return 1; }
      const r = (await controlRequest(join(paths.runtimeDir, "control.sock"), { cmd: "revoke", peerId: match[0].peerId })) as { revoked: boolean };
      out(r.revoked ? `revoked ${match[0].peerId.slice(0, 8)}` : "nothing revoked");
      return 0;
    }
    case "reload": await controlRequest(join(paths.runtimeDir, "control.sock"), { cmd: "reload" }); out("reloaded"); return 0;
    case "tls": {
      const action = args[0] === "rotate" ? "rotate" : "show";
      if (action === "rotate" && !has(args, "--yes")) { out("This replaces the certificate: EVERY paired device must pair again. Re-run with --yes to confirm."); return 1; }
      const r = (await controlRequest(join(paths.runtimeDir, "control.sock"), { cmd: "tls", action })) as { fingerprint: string; rotated: boolean };
      out(`${r.rotated ? "new " : ""}certificate: ${r.fingerprint}`);
      return 0;
    }
    case "stop": await controlRequest(join(paths.runtimeDir, "control.sock"), { cmd: "stop" }); out("stopping"); return 0;

    case "audit": {
      const n = Number(flag(args, "-n") ?? 50);
      for (const l of new AuditLog(join(paths.stateDir, "audit.log")).tail(n)) out(l);
      return 0;
    }

    case "update": {
      const r = await selfUpdate({ currentVersion: VERSION, channel: (flag(args, "--channel") as "stable" | "dev" | undefined), checkOnly: has(args, "--check"), log: out });
      return r ? 0 : 1;
    }

    default: out(`unknown command "${cmd}"\n\n${usage()}`); return 1;
  }
}

main(process.argv.slice(2)).then((code) => { if (code >= 0) process.exit(code); }, (e) => { process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
