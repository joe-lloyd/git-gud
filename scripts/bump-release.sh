#!/usr/bin/env bash
# One-click release: bump package.json, commit "release vX.Y.Z", tag vX.Y.Z,
# and push with --follow-tags. The pushed tag triggers .github/workflows/
# release.yml, which builds the installers and publishes the GitHub Release
# (electron-updater clients pick it up from there).
#
# Usage: scripts/bump-release.sh <major|minor|patch>
#        (or `pnpm release:major` / `release:minor` / `release:patch`)

set -euo pipefail

cd "$(dirname "$0")/.."

kind="${1:-}"
case "$kind" in
  major|minor|patch) ;;
  *) echo "usage: $0 <major|minor|patch>" >&2; exit 1 ;;
esac

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree not clean — commit or stash first." >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "main" ]]; then
  echo "error: releases are cut from main (currently on '$branch')." >&2
  exit 1
fi

# npm edits only the version field and preserves formatting; tagging is ours
# so the commit message and tag match the repo's "release vX.Y.Z" convention.
npm version "$kind" --no-git-tag-version >/dev/null
version="$(node -p "require('./package.json').version")"

git add package.json
git commit -m "release v$version"
git tag "v$version"
# Push branch and tag explicitly — --follow-tags skips lightweight tags, and a
# release where the tag silently stays local never triggers CI.
git push origin HEAD "v$version"

echo "released v$version — CI is building installers (Actions → Release)."
