#!/usr/bin/env bash
# One-shot: delete an existing GitHub Release + tag, then republish the
# current package.json version. Used when a release went out with broken
# binaries and you need to replace the assets — electron-builder refuses
# to overwrite releases older than 2 hours.
#
# Usage: bash scripts/republish.sh

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a; source .env; set +a
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "error: GH_TOKEN missing — set it in .env first." >&2
  exit 1
fi

OWNER=joe-lloyd
REPO=git-gud
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"

api() {
  curl -sS -w '\n%{http_code}' -H "Authorization: Bearer ${GH_TOKEN}" \
       -H "Accept: application/vnd.github+json" "$@"
}

# Find + delete the release for this tag (if any).
RELEASE_JSON=$(curl -sS -H "Authorization: Bearer ${GH_TOKEN}" \
  "https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}" || true)
RELEASE_ID=$(echo "$RELEASE_JSON" | node -e "try{const r=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(r.id||''))}catch{}")

if [[ -n "$RELEASE_ID" ]]; then
  echo "deleting existing release ${TAG} (id ${RELEASE_ID})"
  api -X DELETE "https://api.github.com/repos/${OWNER}/${REPO}/releases/${RELEASE_ID}" >/dev/null
else
  echo "no existing release for ${TAG}"
fi

# Delete the tag too — electron-builder recreates it on publish.
echo "deleting tag ${TAG}"
api -X DELETE "https://api.github.com/repos/${OWNER}/${REPO}/git/refs/tags/${TAG}" >/dev/null || true

echo
echo "republishing…"
bash scripts/release.sh
