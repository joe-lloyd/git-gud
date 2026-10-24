// The companion app's web build in a phone frame, talking to a real Git Gud host.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { _electron as electron, type ElectronApplication, type FrameLocator, type Page } from "playwright-core";

const VIDEO = join(import.meta.dirname, "..");
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".ttf": "font/ttf", ".css": "text/css" };

/** Serves the web export, falling back to index.html for app routes. */
export function serveCompanion(dir: string) {
  if (!existsSync(join(dir, "index.html"))) throw new Error(`No companion web build in ${dir}; run video/tools/companion-web.sh`);
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    let file = join(dir, path);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise<{ url: string; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() })),
  );
}

/** "AB:CD:…" (how Git Gud shows a fingerprint) → the base64url form the stage shell compares. */
const toBase64Url = (hex: string) => Buffer.from(hex.replace(/:/g, ""), "hex").toString("base64url");

export async function launchPhone(opts: { appUrl: string; hostFingerprint: string; userData: string }): Promise<{ shell: ElectronApplication; stage: Page; phone: FrameLocator }> {
  const stageUrl = `${pathToFileURL(join(VIDEO, "stage", "phone.html")).href}?app=${encodeURIComponent(opts.appUrl)}`;
  const shell = await electron.launch({
    args: [join(VIDEO, "tools", "stage-shell.cjs")],
    env: { ...process.env, STAGE_URL: stageUrl, STAGE_USER_DATA: opts.userData, STAGE_TRUST: toBase64Url(opts.hostFingerprint), STAGE_INSECURE: "1" },
  });
  const stage = await shell.firstWindow();
  await stage.emulateMedia({ colorScheme: "dark" });
  return { shell, stage, phone: stage.frameLocator("#app") };
}
