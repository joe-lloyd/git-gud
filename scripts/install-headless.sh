#!/bin/bash
# Install (or update) gitgud-headless on Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/joe-lloyd/git-gud/main/scripts/install-headless.sh | bash
#
# Downloads the single-file build from the latest GitHub Release (or --dev for
# the newest pre-release), verifies its sha256, installs to ~/.local/bin and
# the systemd user unit to ~/.config/systemd/user. Needs Node ≥ 20 and git.
set -euo pipefail
REPO="joe-lloyd/git-gud"
BIN_DIR="${GITGUD_HEADLESS_BIN_DIR:-$HOME/.local/bin}"
CHANNEL="stable"; NO_UNIT=0
for a in "$@"; do case "$a" in --dev) CHANNEL=dev;; --no-unit) NO_UNIT=1;; *) echo "unknown option $a" >&2; exit 2;; esac; done

command -v node >/dev/null || { echo "node ≥ 20 is required (https://nodejs.org or your package manager)" >&2; exit 1; }
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]'); [ "$NODE_MAJOR" -ge 20 ] || { echo "node ≥ 20 required, found $(node --version)" >&2; exit 1; }
command -v git >/dev/null || { echo "git is required" >&2; exit 1; }

if [ "$CHANNEL" = dev ]; then
  TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=30" | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"\(v[^"]*\)"/\1/')
else
  TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -o '"tag_name": *"[^"]*"' | sed 's/.*"\(v[^"]*\)"/\1/')
fi
VERSION="${TAG#v}"; ASSET="gitgud-headless-${VERSION}.js"; BASE="https://github.com/$REPO/releases/download/$TAG"
echo "installing gitgud-headless $VERSION ($CHANNEL) → $BIN_DIR"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/$ASSET" "$BASE/$ASSET"; curl -fsSL -o "$TMP/$ASSET.sha256" "$BASE/$ASSET.sha256"
(cd "$TMP" && sha256sum -c "$ASSET.sha256" >/dev/null) || { echo "checksum mismatch" >&2; exit 1; }
mkdir -p "$BIN_DIR"; install -m 0755 "$TMP/$ASSET" "$BIN_DIR/gitgud-headless"
echo "$("$BIN_DIR/gitgud-headless" --version) installed"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) echo "note: add $BIN_DIR to your PATH";; esac

if [ "$NO_UNIT" = 0 ] && command -v systemctl >/dev/null; then
  mkdir -p "$HOME/.config/systemd/user"
  curl -fsSL -o "$HOME/.config/systemd/user/gitgud-headless.service" "https://raw.githubusercontent.com/$REPO/$TAG/resources/gitgud-headless.service"
  systemctl --user daemon-reload
  echo "systemd unit installed. Next:"
  echo "  gitgud-headless init            # then edit $(XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}; echo $XDG_CONFIG_HOME/gitgud-headless/config.jsonc)"
  echo "  systemctl --user enable --now gitgud-headless && loginctl enable-linger \$USER"
  echo "  gitgud-headless pair            # code + fingerprint for the Git Gud GUI"
fi
