// Push notifications for companion devices via the Expo Push API. The only
// place a host talks to a third party, so it is opt-in per host and carries
// metadata only (machine, repo name, event kind) — never diffs or paths
// beyond the repo folder name.
import * as https from "https";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const DEBOUNCE_MS = 30_000;

export type PushEventKind = "repo-changed" | "activity";

export interface PushSubscriber {
  peerId: string;
  pushToken: string; // ExponentPushToken[…]
  events: PushEventKind[];
}

export function isExpoPushToken(t: string): boolean {
  return /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/.test(t);
}

export interface PushNotifierDeps {
  enabled(): boolean;
  subscribers(): PushSubscriber[];
  machineName(): string;
  send?(messages: unknown[]): Promise<void>; // injectable for tests
  log?(msg: string): void;
}

export class PushNotifier {
  private lastSent = new Map<string, number>(); // `${peerId}|${repo}|${kind}` → ts
  private timers = new Map<string, NodeJS.Timeout>();
  constructor(private deps: PushNotifierDeps) {}

  // Debounced per (device, repo, kind): first event fires immediately, then
  // at most one more per 30 s window (trailing).
  notify(repoPath: string, kind: PushEventKind, detail?: string): void {
    if (!this.deps.enabled()) return;
    const repo = repoPath.split(/[\\/]/).filter(Boolean).pop() ?? repoPath;
    for (const s of this.deps.subscribers()) {
      if (!s.events.includes(kind)) continue;
      const key = `${s.peerId}|${repo}|${kind}`;
      const last = this.lastSent.get(key) ?? 0;
      const now = Date.now();
      if (now - last >= DEBOUNCE_MS) { this.fire(s, repo, kind, detail, key); continue; }
      if (!this.timers.has(key)) {
        this.timers.set(key, setTimeout(() => { this.timers.delete(key); this.fire(s, repo, kind, detail, key); }, DEBOUNCE_MS - (now - last)));
      }
    }
  }

  private fire(s: PushSubscriber, repo: string, kind: PushEventKind, detail: string | undefined, key: string): void {
    this.lastSent.set(key, Date.now());
    const machine = this.deps.machineName();
    const msg = {
      to: s.pushToken,
      title: kind === "repo-changed" ? `${repo} changed` : `${repo}: ${detail ?? "activity"}`,
      body: `on ${machine}`,
      data: { machine, repo, kind },
      channelId: "gitgud",
      priority: "default",
    };
    (this.deps.send ?? sendExpo)([msg]).catch((e) => this.deps.log?.(`push: ${String(e)}`));
  }

  stop(): void { for (const t of this.timers.values()) clearTimeout(t); this.timers.clear(); }
}

export function sendExpo(messages: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(messages);
    const req = https.request(EXPO_PUSH_URL, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => {
      res.resume();
      res.on("end", () => (res.statusCode && res.statusCode < 300 ? resolve() : reject(new Error(`Expo push HTTP ${res.statusCode}`))));
    });
    req.on("error", reject);
    req.setTimeout(10_000, () => req.destroy(new Error("Expo push timeout")));
    req.end(body);
  });
}
