#!/usr/bin/env bash
# Build resources/icon.icns from resources/icon.png using only macOS-native
# tools (sips, iconutil). Run after scripts/render-icon.cjs.

set -euo pipefail

cd "$(dirname "$0")/.."

SRC="resources/icon.png"
ICONSET="resources/icon.iconset"
OUT="resources/icon.icns"

if [[ ! -f "$SRC" ]]; then
  echo "missing $SRC — run: pnpm exec electron scripts/render-icon.cjs" >&2
  exit 1
fi

rm -rf "$ICONSET"
mkdir -p "$ICONSET"

# Apple's required sizes for a complete iconset.
sips -z   16  16  "$SRC" --out "$ICONSET/icon_16x16.png"        >/dev/null
sips -z   32  32  "$SRC" --out "$ICONSET/icon_16x16@2x.png"     >/dev/null
sips -z   32  32  "$SRC" --out "$ICONSET/icon_32x32.png"        >/dev/null
sips -z   64  64  "$SRC" --out "$ICONSET/icon_32x32@2x.png"     >/dev/null
sips -z  128 128  "$SRC" --out "$ICONSET/icon_128x128.png"      >/dev/null
sips -z  256 256  "$SRC" --out "$ICONSET/icon_128x128@2x.png"   >/dev/null
sips -z  256 256  "$SRC" --out "$ICONSET/icon_256x256.png"      >/dev/null
sips -z  512 512  "$SRC" --out "$ICONSET/icon_256x256@2x.png"   >/dev/null
sips -z  512 512  "$SRC" --out "$ICONSET/icon_512x512.png"      >/dev/null
cp "$SRC" "$ICONSET/icon_512x512@2x.png"

iconutil -c icns "$ICONSET" -o "$OUT"
rm -rf "$ICONSET"
echo "wrote $OUT"
