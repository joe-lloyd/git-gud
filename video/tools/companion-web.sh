#!/usr/bin/env bash
# Builds the companion app's web export for the phone scenes, without changing the repo.
#
#   video/tools/companion-web.sh [out-dir]     # default /tmp/gg-companion-web
#
# The app ships for Android and iOS only, so react-dom, react-native-web and
# @expo/metro-runtime are added just for this build; package.json and the
# lockfile are put back afterwards. Web has no certificate pinning; the phone
# stage trusts exactly the one host certificate instead.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-/tmp/gg-companion-web}"
BACKUP="$(mktemp -d)"
cp "$ROOT/pnpm-lock.yaml" "$BACKUP/pnpm-lock.yaml"
cp "$ROOT/apps/companion/package.json" "$BACKUP/package.json"
cp "$ROOT/apps/companion/metro.config.js" "$BACKUP/metro.config.js"
restore() {
  cp "$BACKUP/pnpm-lock.yaml" "$ROOT/pnpm-lock.yaml"
  cp "$BACKUP/package.json" "$ROOT/apps/companion/package.json"
  cp "$BACKUP/metro.config.js" "$ROOT/apps/companion/metro.config.js"
}
trap restore EXIT
(cd "$ROOT" && pnpm --filter @gitgud/companion add react-dom@19.0.0 react-native-web@~0.20.0 @expo/metro-runtime@~5.0.4 >/dev/null)
# expo-secure-store has no web implementation; swap in a localStorage shim for this build only.
cat >> "$ROOT/apps/companion/metro.config.js" <<SHIM
{
  const shimmed = config.resolver.resolveRequest
  config.resolver.resolveRequest = (context, moduleName, platform) =>
    platform === 'web' && moduleName === 'expo-secure-store'
      ? { type: 'sourceFile', filePath: '$ROOT/video/tools/web-shims/secure-store.js' }
      : (shimmed || context.resolveRequest)(context, moduleName, platform)
}
SHIM
(cd "$ROOT/apps/companion" && rm -rf web-build && pnpm exec expo export --platform web --output-dir web-build >/dev/null)
rm -rf "$OUT" && mv "$ROOT/apps/companion/web-build" "$OUT"
echo "companion web build: $OUT"
