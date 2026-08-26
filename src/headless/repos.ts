// Repo allow-list for the daemon: explicit paths + depth-limited scan roots,
// canonicalised the same way the GUI does. Rescanned on demand (SIGHUP /
// `reload`) and on a slow timer so new clones show up without a restart.
import * as fs from "fs";
import { join } from "path";
import { canonicalPath } from "../main/peer-host-core";
import type { ScanRoot } from "./config";

const MAX_REPOS = 200;
const SKIP_DIRS = new Set(["node_modules", ".git", ".cache", ".Trash", "Library", "snap"]);

export function isGitRepoDir(p: string): boolean {
  try {
    const g = join(p, ".git");
    const st = fs.statSync(g);
    return st.isDirectory() || st.isFile(); // file = worktree / submodule gitlink
  } catch { return false; }
}

export function scanForRepos(root: ScanRoot, log?: (m: string) => void): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= MAX_REPOS) return;
    if (isGitRepoDir(dir)) { out.push(dir); return; } // don't descend into repos
    if (depth === 0) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { log?.(`scan: cannot read ${dir}: ${String(e)}`); return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      walk(join(dir, e.name), depth - 1);
    }
  };
  walk(root.path, root.depth);
  return out;
}

export class ConfigRepoAllowList {
  private cache = new Map<string, boolean>();
  private lastScan = 0;

  constructor(private repos: () => string[], private scanRoots: () => ScanRoot[], private log?: (m: string) => void) {}

  refresh(): Map<string, boolean> {
    const out = new Map<string, boolean>();
    for (const r of this.repos()) {
      if (!isGitRepoDir(r)) { this.log?.(`repos: ${r} is not a git repository — skipped`); continue; }
      out.set(canonicalPath(r), true);
    }
    for (const root of this.scanRoots()) {
      for (const r of scanForRepos(root, this.log)) {
        const c = canonicalPath(r);
        if (!out.has(c)) out.set(c, false);
        if (out.size >= MAX_REPOS) break;
      }
    }
    this.cache = out;
    this.lastScan = Date.now();
    return out;
  }

  // Cheap on the hot path: rescan at most every 5 minutes unless forced.
  current(): Map<string, boolean> {
    if (Date.now() - this.lastScan > 5 * 60_000) this.refresh();
    return this.cache;
  }
}
