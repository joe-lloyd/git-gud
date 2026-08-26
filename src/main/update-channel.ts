// Update channel plumbing shared by the mac updater and main's electron-updater
// setup. Pure functions only (no electron import) so they unit-test in node.
//
//   stable → GitHub "latest" release (GitHub never marks a pre-release latest)
//   dev    → newest release *including* pre-releases (v1.11.0-dev.N builds cut
//            with `pnpm release:dev`)
//
// A dev build on the dev channel keeps receiving dev builds; switching it to
// stable simply waits for the next stable version that outranks it — the
// updater never downgrades.

export type UpdateChannel = "stable" | "dev";

export const UPDATE_CHANNELS: UpdateChannel[] = ["stable", "dev"];

export function isUpdateChannel(v: unknown): v is UpdateChannel {
  return v === "stable" || v === "dev";
}

export function isPrereleaseVersion(v: string): boolean {
  return /-/.test(v);
}

// A build with a prerelease tag defaults to the dev channel (it came from
// there); anything else defaults to stable. Only used when no choice is saved.
export function defaultChannelFor(version: string): UpdateChannel {
  return isPrereleaseVersion(version) ? "dev" : "stable";
}

// Semver-ish compare: numeric core, then prerelease rules — a prerelease sorts
// *below* its release (1.11.0-dev.3 < 1.11.0), prerelease identifiers compare
// numerically when both are numbers, else lexically. Returns <0, 0, >0.
export function compareVersions(a: string, b: string): number {
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = pa.core[i] - pb.core[i];
    if (d !== 0) return d;
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i], y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) { const d = Number(x) - Number(y); if (d !== 0) return d; }
    else if (nx !== ny) return nx ? -1 : 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function parse(v: string): { core: number[]; pre: string[] } {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(v.trim());
  if (!m) return { core: [0, 0, 0], pre: [] };
  return {
    core: [m[1], m[2], m[3]].map((n) => parseInt(n ?? "0", 10) || 0),
    pre: m[4] ? m[4].split(".") : [],
  };
}

// True when `candidate` is strictly newer than `current`.
export function isNewerVersion(current: string, candidate: string): boolean {
  return compareVersions(current, candidate) < 0;
}

// Subset of the GitHub REST release object we read.
export interface GitHubRelease {
  tag_name: string;
  prerelease: boolean;
  draft?: boolean;
}

// Pick the release the given channel should track from a GitHub
// `/repos/:o/:r/releases` listing: highest version, drafts skipped, pre-
// releases only on the dev channel. Null when nothing qualifies.
export function pickRelease(releases: GitHubRelease[], channel: UpdateChannel): GitHubRelease | null {
  let best: GitHubRelease | null = null;
  for (const r of releases) {
    if (r.draft) continue;
    if (r.prerelease && channel !== "dev") continue;
    if (!/^v?\d+\.\d+/.test(r.tag_name)) continue;
    if (!best || compareVersions(best.tag_name, r.tag_name) < 0) best = r;
  }
  return best;
}
