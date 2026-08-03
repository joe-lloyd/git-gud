import { safeStorage, app } from "electron";
import * as fs from "fs";
import { join } from "path";
import {
  normalizeGerritHost,
  stripXssiPrefix,
  mapGerritChange,
  type GerritChange,
} from "./gerrit-utils";

// Read-only Gerrit REST client + credential store. Detection and refspec
// helpers live in gerrit-utils.ts (pure, electron-free). Credentials are a
// Gerrit HTTP password per host, encrypted with safeStorage like the other
// provider tokens — they never reach the renderer or a repo.

export class GerritService {
  private configPath: string;
  private auth: Record<string, { username: string; password: string }> = {};

  constructor() {
    this.configPath = join(app.getPath("userData"), "gerrit-auth.json");
    this.load();
  }

  private load() {
    try {
      if (!fs.existsSync(this.configPath)) return;
      const raw = fs.readFileSync(this.configPath);
      const json = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(raw)
        : raw.toString("utf-8");
      this.auth = JSON.parse(json);
    } catch (e) {
      console.error("Failed to load Gerrit auth", e);
      this.auth = {};
    }
  }

  private save() {
    try {
      const json = JSON.stringify(this.auth);
      const data = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(json)
        : Buffer.from(json, "utf-8");
      fs.writeFileSync(this.configPath, data);
    } catch (e) {
      console.error("Failed to save Gerrit auth", e);
      throw new Error("Failed to save credentials securely.");
    }
  }

  setAuth(host: string, username: string, password: string) {
    this.auth[normalizeGerritHost(host)] = { username: username.trim(), password };
    this.save();
  }

  clearAuth(host: string) {
    delete this.auth[normalizeGerritHost(host)];
    this.save();
  }

  hasAuth(host: string): boolean {
    return Boolean(this.auth[normalizeGerritHost(host)]);
  }

  // GET against the Gerrit REST API. Auth precedence: explicitly stored
  // credentials (Basic) → git's cookie file (how googlesource authenticates)
  // → anonymous. Any authenticated request goes through the `/a/` prefix.
  private async gerritFetch(host: string, path: string, cookieHeader?: string): Promise<any> {
    const base = normalizeGerritHost(host);
    const auth = this.auth[base];
    const authenticated = Boolean(auth || cookieHeader);
    const url = `${base}${authenticated ? "/a" : ""}${path}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (auth) {
      headers.Authorization =
        "Basic " + Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
    } else if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gerrit API ${res.status}: ${body.trim().slice(0, 200) || res.statusText}`);
    }
    return JSON.parse(stripXssiPrefix(await res.text()));
  }

  // Which auth the next request to `host` would use — surfaced to the UI as a
  // label only; the credentials themselves never leave the main process.
  authModeFor(host: string, cookieHeader?: string): "stored" | "gitcookies" | "anonymous" {
    if (this.auth[normalizeGerritHost(host)]) return "stored";
    if (cookieHeader) return "gitcookies";
    return "anonymous";
  }

  async listOpenChanges(host: string, project: string, cookieHeader?: string): Promise<GerritChange[]> {
    const query = encodeURIComponent(`project:${project} status:open`);
    const raw = await this.gerritFetch(
      host,
      // ALL_REVISIONS: the full patchset (amendment) history per change, so
      // the commit-detail view can show it without extra round-trips.
      `/changes/?q=${query}&o=ALL_REVISIONS&o=DETAILED_ACCOUNTS&n=100`,
      cookieHeader,
    );
    if (!Array.isArray(raw)) throw new Error("Gerrit API returned an unexpected shape");
    return raw.map((c: any) => mapGerritChange(host, c));
  }
}
