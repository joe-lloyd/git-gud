import { launchGitGud } from "./app.ts";
import { execFileSync } from "node:child_process";
execFileSync("bash", ["demo/build-demo.sh", "/Users/Shared/probe"], { stdio: "ignore" });
const { app, page } = await launchGitGud({ userData: "/tmp/gg-probe-ud-" + Date.now(), tabs: ["/Users/Shared/probe/tidepool"] });
await page.locator(".commit-row").first().waitFor();
const snippet = (await import(process.argv[2]!)).default;
try { await snippet(page, app); } finally { await app.close(); execFileSync("rm", ["-rf", "/Users/Shared/probe"]); }
