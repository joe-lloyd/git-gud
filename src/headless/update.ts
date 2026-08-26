// Self-update from GitHub Releases: pick the release for the channel (same
// logic as the desktop updater), download gitgud-headless-<ver>.js + .sha256,
// verify, swap the running script atomically. systemd restarts on `reload`.
import * as fs from "fs";
import { createHash } from "crypto";
import { compareVersions, defaultChannelFor, pickRelease, type GitHubRelease, type UpdateChannel } from "../main/update-channel";

const REPO = "joe-lloyd/git-gud";

export async function selfUpdate(o: { currentVersion: string; channel?: UpdateChannel; checkOnly?: boolean; log: (s: string) => void; targetPath?: string; fetchImpl?: typeof fetch }): Promise<boolean> {
  const f = o.fetchImpl ?? fetch;
  const channel = o.channel ?? defaultChannelFor(o.currentVersion);
  const res = await f(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "gitgud-headless" } });
  if (!res.ok) { o.log(`GitHub API HTTP ${res.status}`); return false; }
  const rel = pickRelease((await res.json()) as GitHubRelease[], channel);
  if (!rel) { o.log("no release found"); return false; }
  const version = rel.tag_name.replace(/^v/, "");
  if (compareVersions(o.currentVersion, version) >= 0) { o.log(`up to date (${o.currentVersion}, channel ${channel})`); return true; }
  o.log(`${o.currentVersion} → ${version} (${channel})`);
  if (o.checkOnly) return true;
  const base = `https://github.com/${REPO}/releases/download/${rel.tag_name}/`;
  const asset = `gitgud-headless-${version}.js`;
  const [js, sha] = await Promise.all([f(base + asset), f(base + asset + ".sha256")]);
  if (!js.ok || !sha.ok) { o.log(`download failed (${js.status}/${sha.status}) — this release may not include a headless build`); return false; }
  const body = Buffer.from(await js.arrayBuffer());
  const expected = (await sha.text()).trim().split(/\s+/)[0].toLowerCase();
  const actual = createHash("sha256").update(body).digest("hex");
  if (actual !== expected) { o.log("checksum mismatch — aborting"); return false; }
  const target = o.targetPath ?? process.argv[1];
  const tmp = target + ".new";
  fs.writeFileSync(tmp, body, { mode: 0o755 });
  fs.renameSync(tmp, target);
  o.log(`installed ${version} → ${target}. Restart: systemctl --user restart gitgud-headless`);
  return true;
}
