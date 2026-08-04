// ── Unsigned-macOS auto-updater ────────────────────────────────────────────
// electron-updater's mac path hands the downloaded ZIP to Squirrel.Mac, which
// refuses to swap an app that isn't code-signed — and this app ships with
// `identity: null`. So on macOS we do the swap ourselves:
//
//   1. read latest-mac.yml from the GitHub release feed
//   2. download the matching-arch ZIP with progress, verify its sha512
//   3. unpack next to userData, then on install spawn a detached shell that
//      waits for the app to quit, replaces the .app bundle, and reopens it
//
// The download never touches a browser, so the replacement bundle carries no
// quarantine attribute and Gatekeeper does not re-prompt. If the app ever
// gets a real Developer ID signature, delete this file and let
// electron-updater handle macOS too.
import { app } from "electron";
import { createHash } from "crypto";
import { spawn, execFile } from "child_process";
import * as fs from "fs";
import * as fsp from "fs/promises";
import { join, resolve, dirname } from "path";

const FEED_URL =
  "https://github.com/joe-lloyd/git-gud/releases/latest/download/latest-mac.yml";

export interface MacUpdateEvents {
  onStatus: (payload: {
    state: "checking" | "available" | "none" | "downloaded" | "error";
    version?: string;
    error?: string;
  }) => void;
  onProgress: (payload: { percent: number }) => void;
}

interface FeedFile {
  url: string;
  sha512: string;
  size: number;
}

// Minimal parse of electron-builder's latest-mac.yml — flat keys plus one
// `files:` list. A YAML dependency isn't warranted for this fixed shape.
export function parseFeed(yml: string): { version: string; files: FeedFile[] } {
  const version = /^version:\s*(\S+)/m.exec(yml)?.[1] ?? "";
  const files: FeedFile[] = [];
  const re = /-\s+url:\s*(\S+)\s*\n\s+sha512:\s*(\S+)\s*\n\s+size:\s*(\d+)/g;
  for (let m = re.exec(yml); m; m = re.exec(yml)) {
    files.push({ url: m[1], sha512: m[2], size: parseInt(m[3], 10) });
  }
  return { version, files };
}

// True when b is a strictly newer x.y.z than a. Non-numeric parts compare as 0.
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

// Pick the ZIP for this machine's arch: arm64 builds are "…-arm64-mac.zip",
// x64 builds are plain "…-mac.zip".
export function pickAsset(files: FeedFile[], arch: string): FeedFile | null {
  const zips = files.filter((f) => f.url.endsWith("-mac.zip"));
  if (arch === "arm64") return zips.find((f) => f.url.includes("arm64")) ?? null;
  return zips.find((f) => !f.url.includes("arm64")) ?? null;
}

export class MacUpdater {
  private events: MacUpdateEvents;
  private downloading = false;
  // Set once a verified .app is unpacked and ready to swap in.
  private readyBundle: { appPath: string; version: string } | null = null;

  constructor(events: MacUpdateEvents) {
    this.events = events;
  }

  private workDir(): string {
    return join(app.getPath("userData"), "pending-update");
  }

  // Check the feed; when a newer version exists, download + verify + unpack
  // in the background (mirrors electron-updater's autoDownload behaviour).
  // Returns the remote version like autoUpdater.checkForUpdates.
  async checkForUpdates(): Promise<{ version?: string }> {
    this.events.onStatus({ state: "checking" });
    try {
      const res = await fetch(FEED_URL, { redirect: "follow" });
      if (!res.ok) throw new Error(`Update feed HTTP ${res.status}`);
      const feed = parseFeed(await res.text());
      if (!feed.version) throw new Error("Update feed missing version");

      if (!isNewerVersion(app.getVersion(), feed.version)) {
        this.events.onStatus({ state: "none" });
        return { version: feed.version };
      }

      this.events.onStatus({ state: "available", version: feed.version });
      if (this.readyBundle?.version === feed.version) {
        // Already downloaded this version earlier in the session.
        this.events.onStatus({ state: "downloaded", version: feed.version });
      } else if (!this.downloading) {
        this.downloading = true;
        this.download(feed).finally(() => {
          this.downloading = false;
        });
      }
      return { version: feed.version };
    } catch (e) {
      this.events.onStatus({ state: "error", error: String(e) });
      throw e;
    }
  }

  private async download(feed: { version: string; files: FeedFile[] }): Promise<void> {
    try {
      const asset = pickAsset(feed.files, process.arch);
      if (!asset) throw new Error(`No mac zip for arch ${process.arch} in update feed`);

      const dir = this.workDir();
      await fsp.rm(dir, { recursive: true, force: true });
      await fsp.mkdir(dir, { recursive: true });
      const zipPath = join(dir, asset.url);

      // Assets sit next to the feed under the same release.
      const url = FEED_URL.replace(/latest-mac\.yml$/, asset.url);
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok || !res.body) throw new Error(`Download HTTP ${res.status}`);

      const total = Number(res.headers.get("content-length")) || asset.size;
      const hash = createHash("sha512");
      const out = fs.createWriteStream(zipPath);
      let received = 0;
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          hash.update(value);
          received += value.length;
          if (!out.write(value)) {
            await new Promise<void>((r) => out.once("drain", () => r()));
          }
          this.events.onProgress({ percent: Math.min(100, (received / total) * 100) });
        }
      } finally {
        await new Promise<void>((r) => out.end(() => r()));
      }

      const digest = hash.digest("base64");
      if (digest !== asset.sha512) {
        throw new Error(`Update checksum mismatch for ${asset.url}`);
      }

      // ditto preserves symlinks + resource forks that plain unzip libraries
      // mangle inside .app bundles.
      await new Promise<void>((res2, rej) => {
        execFile("/usr/bin/ditto", ["-x", "-k", zipPath, dir], (err) =>
          err ? rej(err) : res2(),
        );
      });
      await fsp.rm(zipPath, { force: true });

      const entries = await fsp.readdir(dir);
      const bundleName = entries.find((e) => e.endsWith(".app"));
      if (!bundleName) throw new Error("Update zip contained no .app bundle");

      this.readyBundle = { appPath: join(dir, bundleName), version: feed.version };
      this.events.onStatus({ state: "downloaded", version: feed.version });
    } catch (e) {
      this.events.onStatus({ state: "error", error: String(e) });
    }
  }

  // Swap the running bundle for the downloaded one. The shell script is
  // detached and survives the quit: it waits for this pid to die, replaces
  // the .app, clears any quarantine flag, and relaunches.
  quitAndInstall(): void {
    if (!this.readyBundle) return;
    // /Applications/Git Gud.app/Contents/MacOS/Git Gud → the .app bundle.
    const target = resolve(dirname(app.getPath("exe")), "..", "..");
    if (!target.endsWith(".app")) return; // never rm -rf a non-bundle path

    const script = `
      while /bin/kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done
      rm -rf "$TARGET_APP"
      mv "$NEW_APP" "$TARGET_APP"
      /usr/bin/xattr -dr com.apple.quarantine "$TARGET_APP" 2>/dev/null || true
      /usr/bin/open "$TARGET_APP"
      rm -rf "$WORK_DIR"
    `;
    spawn("/bin/sh", ["-c", script], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        TARGET_APP: target,
        NEW_APP: this.readyBundle.appPath,
        WORK_DIR: this.workDir(),
      },
    }).unref();
    app.quit();
  }
}
