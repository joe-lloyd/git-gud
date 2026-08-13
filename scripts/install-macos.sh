#!/bin/bash
# Install (or update) Git Gud on macOS without tripping Gatekeeper.
#
#   curl -fsSL https://raw.githubusercontent.com/joe-lloyd/git-gud/main/scripts/install-macos.sh | bash
#
# Browsers stamp downloads with com.apple.quarantine, and Gatekeeper refuses
# the unsigned bundle with a "damaged" dialog. curl sets no such flag, so an
# app installed this way launches cleanly — the same reason in-app updates
# (src/main/mac-updater.ts) never prompt. The script downloads the update
# feed the app itself uses, picks the right-arch ZIP, verifies its sha512,
# and installs it into /Applications.
#
# Flags / env:
#   --no-open                don't launch the app after installing
#   GIT_GUD_INSTALL_DIR      install somewhere other than /Applications
set -euo pipefail

REPO="joe-lloyd/git-gud"
FEED_URL="https://github.com/${REPO}/releases/latest/download/latest-mac.yml"
INSTALL_DIR="${GIT_GUD_INSTALL_DIR:-/Applications}"
APP_NAME="Git Gud.app"
TARGET="${INSTALL_DIR}/${APP_NAME}"

OPEN_AFTER=1
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN_AFTER=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is macOS-only. See https://joe-lloyd.github.io/git-gud/install/ for other platforms." >&2
  exit 1
fi

WORK_DIR="$(mktemp -d -t git-gud-install)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Fetching release feed…"
curl -fsSL "$FEED_URL" -o "$WORK_DIR/latest-mac.yml"

VERSION="$(awk '/^version:/ { print $2; exit }' "$WORK_DIR/latest-mac.yml")"
if [[ -z "$VERSION" ]]; then
  echo "Could not read a version from the update feed." >&2
  exit 1
fi

# Same asset naming the in-app updater relies on (mac-updater.ts pickAsset):
# arm64 builds are "…-arm64-mac.zip", x64 builds are plain "…-mac.zip".
case "$(uname -m)" in
  arm64)  ZIP_NAME="Git-Gud-${VERSION}-arm64-mac.zip" ;;
  x86_64) ZIP_NAME="Git-Gud-${VERSION}-mac.zip" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

# The sha512 (base64) sits on the line after the matching url entry.
EXPECTED_SHA="$(awk -v u="$ZIP_NAME" '
  $1 == "-" && $2 == "url:" && $3 == u { found = 1; next }
  found && $1 == "sha512:" { print $2; exit }
' "$WORK_DIR/latest-mac.yml")"
if [[ -z "$EXPECTED_SHA" ]]; then
  echo "Update feed has no entry for ${ZIP_NAME} — asset naming may have changed." >&2
  exit 1
fi

echo "Downloading Git Gud ${VERSION} ($ZIP_NAME)…"
curl -fL --progress-bar "https://github.com/${REPO}/releases/latest/download/${ZIP_NAME}" \
  -o "$WORK_DIR/$ZIP_NAME"

ACTUAL_SHA="$(openssl dgst -sha512 -binary "$WORK_DIR/$ZIP_NAME" | base64 | tr -d '\n')"
if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  echo "Checksum mismatch for ${ZIP_NAME} — download corrupted or feed out of date. Nothing was installed." >&2
  exit 1
fi

# ditto preserves the symlinks + resource forks inside .app bundles that
# plain unzip mangles.
/usr/bin/ditto -x -k "$WORK_DIR/$ZIP_NAME" "$WORK_DIR/unpacked"
BUNDLE="$(find "$WORK_DIR/unpacked" -maxdepth 1 -name '*.app' -print -quit)"
if [[ -z "$BUNDLE" ]]; then
  echo "The downloaded ZIP contained no .app bundle." >&2
  exit 1
fi

if [[ -d "$TARGET" ]] && pgrep -f "${TARGET}/Contents/MacOS/" >/dev/null 2>&1; then
  echo "Git Gud is currently running — quit it, then re-run this installer." >&2
  exit 1
fi

if [[ ! -w "$INSTALL_DIR" ]]; then
  echo "No write permission for ${INSTALL_DIR}. Re-run with sudo, or set GIT_GUD_INSTALL_DIR to a writable location." >&2
  exit 1
fi

rm -rf "$TARGET"
# ditto instead of mv: mktemp dirs can sit on another volume, where mv fails.
/usr/bin/ditto "$BUNDLE" "$TARGET"

# curl doesn't quarantine, but clear the flag anyway in case the script ran
# against a bundle a browser touched.
/usr/bin/xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true

echo "Installed Git Gud ${VERSION} → ${TARGET}"
if [[ "$OPEN_AFTER" == "1" ]]; then
  /usr/bin/open "$TARGET"
fi
