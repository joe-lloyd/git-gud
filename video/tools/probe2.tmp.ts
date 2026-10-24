import { launchGitGud } from "./app.ts";
import { execFileSync } from "node:child_process";
execFileSync("bash", ["demo/build-demo.sh", "/Users/Shared/buildbox"], { stdio: "ignore" });
const host = await launchGitGud({ userData: "/tmp/gg-peer-b-" + Date.now(), tabs: ["/Users/Shared/buildbox/tidepool"] });
const client = await launchGitGud({ userData: "/tmp/gg-peer-a-" + Date.now(), recent: [] });
try {
  await host.page.locator(".commit-row").first().waitFor();
  const st = await host.page.evaluate(() => (window as any).peerApi.setServer({ enabled: true, name: "build-box" }));
  console.log("host state:", JSON.stringify(st).slice(0, 400));
  await host.page.getByTitle("Settings").click(); await host.page.waitForTimeout(800);
  await host.page.screenshot({ path: "/tmp/gg-video-scratch/peer-host.png" });
  await client.page.getByRole("button", { name: /Connect to a Peer/ }).click(); await client.page.waitForTimeout(4000);
  await client.page.screenshot({ path: "/tmp/gg-video-scratch/peer-client.png" });
  console.log("client modal:", (await client.page.locator(".peer-modal").innerText()).replace(/\s+/g, " ").slice(0, 500));
} finally { await host.app.close(); await client.app.close(); execFileSync("rm", ["-rf", "/Users/Shared/buildbox"]); }
