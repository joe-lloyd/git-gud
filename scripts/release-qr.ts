// Writes a PNG QR code for a URL. Used by the release workflow so the GitHub
// Release notes can show a scannable "install the companion APK" code.
//
//   pnpm qr:png <url> <out.png> [scale]
//
// Bundled with esbuild at call time (see package.json "qr:png") because it
// pulls in src/main/qr.ts, which is TypeScript.
import { writeFileSync } from "fs";
import { renderQrPng } from "../src/main/qr-png";

const [url, out, scale] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: release-qr <url> <out.png> [scale]");
  process.exit(2);
}
writeFileSync(out, renderQrPng(url, { scale: scale ? Number(scale) : 10, quiet: 4 }));
console.log(`wrote ${out} for ${url}`);
