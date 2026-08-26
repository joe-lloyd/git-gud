// gitgud-headless configuration: JSONC file + XDG directories.
// No dependencies — comments are stripped with a small tokenizer that
// respects strings, then JSON.parse does the rest.
import * as fs from "fs";
import * as os from "os";
import { join } from "path";

export interface ScanRoot { path: string; depth: number }

export interface HeadlessConfig {
  name: string;
  port: number;
  // IP address or interface name (e.g. "127.0.0.1", "0.0.0.0", "tailscale0").
  bind: string;
  discovery: boolean;
  readOnly: boolean;
  repos: string[];
  scanRoots: ScanRoot[];
  // Only these peer ids may pair/connect; empty = anyone with the code.
  allowPeerIds: string[];
  // Writes refused even when writable. Both defaults can lead to arbitrary
  // execution on the host (core.hooksPath / core.sshCommand, hook files).
  denyMethods: string[];
  // How long a requested pairing code stays valid (minutes).
  pairingWindowMinutes: number;
  // M5: reverse connection to a rendezvous/relay service.
  rendezvous?: { url: string; token: string } | null;
  // Expo push opt-in (M3). Off by default: the only place the host talks to
  // a third party.
  push: boolean;
}

export const DEFAULT_CONFIG: HeadlessConfig = {
  name: os.hostname().split(".")[0] || "gitgud-headless",
  port: 47831,
  bind: "127.0.0.1",
  discovery: false,
  readOnly: true,
  repos: [],
  scanRoots: [],
  allowPeerIds: [],
  denyMethods: ["setConfig", "writeFileContent"],
  pairingWindowMinutes: 10,
  rendezvous: null,
  push: false,
};

// ── XDG paths ───────────────────────────────────────────────────────────

export interface HeadlessPaths {
  configDir: string;   // config.jsonc
  dataDir: string;     // identity, TLS key/cert, paired devices (0700)
  stateDir: string;    // audit.log
  runtimeDir: string;  // control socket
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): HeadlessPaths {
  const home = env.HOME || os.homedir();
  const app = "gitgud-headless";
  // GITGUD_HEADLESS_HOME overrides everything — used by tests and by running
  // several daemons on one box.
  if (env.GITGUD_HEADLESS_HOME) {
    const h = env.GITGUD_HEADLESS_HOME;
    return { configDir: h, dataDir: join(h, "data"), stateDir: join(h, "state"), runtimeDir: join(h, "run") };
  }
  return {
    configDir: join(env.XDG_CONFIG_HOME || join(home, ".config"), app),
    dataDir: join(env.XDG_DATA_HOME || join(home, ".local", "share"), app),
    stateDir: join(env.XDG_STATE_HOME || join(home, ".local", "state"), app),
    runtimeDir: env.XDG_RUNTIME_DIR ? join(env.XDG_RUNTIME_DIR, app) : join(env.XDG_STATE_HOME || join(home, ".local", "state"), app),
  };
}

export function ensureDirs(p: HeadlessPaths): void {
  for (const d of [p.configDir, p.dataDir, p.stateDir, p.runtimeDir]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  // Data holds the TLS private key and token hashes: owner-only, always.
  try { fs.chmodSync(p.dataDir, 0o700); } catch { /* non-POSIX */ }
}

// ── JSONC ───────────────────────────────────────────────────────────────

export function stripJsonComments(src: string): string {
  let out = "";
  let i = 0;
  let inStr = false;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") { out += n ?? ""; i += 2; continue; }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    out += c;
    i++;
  }
  // Trailing commas before } or ] are a common JSONC habit.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

export function parseConfig(text: string): HeadlessConfig {
  const raw = JSON.parse(stripJsonComments(text)) as Partial<HeadlessConfig> & Record<string, unknown>;
  const cfg: HeadlessConfig = { ...DEFAULT_CONFIG, ...pick(raw) };
  validate(cfg);
  return cfg;
}

function pick(raw: Record<string, unknown>): Partial<HeadlessConfig> {
  const out: Partial<HeadlessConfig> = {};
  if (typeof raw.name === "string") out.name = raw.name.trim().slice(0, 64);
  if (typeof raw.port === "number") out.port = raw.port;
  if (typeof raw.bind === "string") out.bind = raw.bind.trim();
  if (typeof raw.discovery === "boolean") out.discovery = raw.discovery;
  if (typeof raw.readOnly === "boolean") out.readOnly = raw.readOnly;
  if (typeof raw.push === "boolean") out.push = raw.push;
  if (Array.isArray(raw.repos)) out.repos = raw.repos.filter((x): x is string => typeof x === "string");
  if (Array.isArray(raw.scanRoots)) {
    out.scanRoots = raw.scanRoots
      .map((r) => (typeof r === "string" ? { path: r, depth: 1 } : r))
      .filter((r): r is ScanRoot => !!r && typeof (r as ScanRoot).path === "string")
      .map((r) => ({ path: r.path, depth: Number.isInteger(r.depth) ? Math.min(Math.max(r.depth, 0), 4) : 1 }));
  }
  if (Array.isArray(raw.allowPeerIds)) out.allowPeerIds = raw.allowPeerIds.filter((x): x is string => typeof x === "string");
  if (Array.isArray(raw.denyMethods)) out.denyMethods = raw.denyMethods.filter((x): x is string => typeof x === "string");
  if (typeof raw.pairingWindowMinutes === "number") out.pairingWindowMinutes = raw.pairingWindowMinutes;
  if (raw.rendezvous && typeof raw.rendezvous === "object") {
    const r = raw.rendezvous as { url?: unknown; token?: unknown };
    if (typeof r.url === "string" && typeof r.token === "string") out.rendezvous = { url: r.url, token: r.token };
  }
  return out;
}

export function validate(cfg: HeadlessConfig): void {
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) throw new Error(`config: port must be 1-65535 (got ${cfg.port})`);
  if (!cfg.bind) throw new Error("config: bind must be an IP or interface name");
  if (!Number.isFinite(cfg.pairingWindowMinutes) || cfg.pairingWindowMinutes < 1) throw new Error("config: pairingWindowMinutes must be ≥ 1");
  for (const r of cfg.repos) if (!r.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(r)) throw new Error(`config: repos entries must be absolute paths (got "${r}")`);
}

export function configPath(p: HeadlessPaths): string {
  return join(p.configDir, "config.jsonc");
}

export function loadConfig(p: HeadlessPaths): HeadlessConfig {
  const file = configPath(p);
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
  return parseConfig(fs.readFileSync(file, "utf8"));
}

// Written by `gitgud-headless init`: every key present, commented.
export function renderDefaultConfig(overrides: Partial<HeadlessConfig> = {}): string {
  const c = { ...DEFAULT_CONFIG, ...overrides };
  return `// gitgud-headless configuration (JSONC — comments allowed).
// Reload without restarting: gitgud-headless reload   (or: systemctl --user reload gitgud-headless)
{
  // Name other Git Gud instances see.
  "name": ${JSON.stringify(c.name)},
  "port": ${c.port},
  // IP or interface name. "127.0.0.1" = only via SSH tunnel; "tailscale0" =
  // only your tailnet; "0.0.0.0" = every interface (read the security notes first).
  "bind": ${JSON.stringify(c.bind)},
  // LAN discovery beacon (UDP 47832). Off on servers; on for a desk machine.
  "discovery": ${c.discovery},
  // Refuse every write (stage, commit, push…). Flip to false to let paired
  // GUIs drive this box's working trees. A paired GUI is then your shell here.
  "readOnly": ${c.readOnly},
  // Repositories to serve (absolute paths)…
  "repos": ${JSON.stringify(c.repos)},
  // …and/or folders to scan for repos, depth-limited (0 = the folder itself).
  "scanRoots": ${JSON.stringify(c.scanRoots)},
  // Only these Git Gud peer ids may pair (empty = anyone holding the code).
  "allowPeerIds": ${JSON.stringify(c.allowPeerIds)},
  // Writes refused even when writable. Both defaults can execute code here.
  "denyMethods": ${JSON.stringify(c.denyMethods)},
  // Minutes a pairing code from \`gitgud-headless pair\` stays valid.
  "pairingWindowMinutes": ${c.pairingWindowMinutes},
  // Reverse connection to a rendezvous/relay (see docs). null = off.
  "rendezvous": ${JSON.stringify(c.rendezvous)},
  // Send push notifications for companion-app devices via Expo (opt-in).
  "push": ${c.push}
}
`;
}

// Resolve "tailscale0" / "eth0" → its first IPv4 address; IPs pass through.
export function resolveBindAddress(bind: string, interfaces: () => NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces): string {
  if (/^[\d.]+$/.test(bind) || bind.includes(":")) return bind;
  const ifs = interfaces();
  const list = ifs[bind];
  if (!list) throw new Error(`bind: no interface named "${bind}" (have: ${Object.keys(ifs).join(", ") || "none"})`);
  const v4 = list.find((a) => a.family === "IPv4" || (a.family as unknown) === 4);
  if (!v4) throw new Error(`bind: interface "${bind}" has no IPv4 address`);
  return v4.address;
}
