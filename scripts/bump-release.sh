#!/usr/bin/env bash
# One-click release: bump package.json, commit "release vX.Y.Z", tag vX.Y.Z,
# and push with --follow-tags. The pushed tag triggers .github/workflows/
# release.yml, which builds the installers and publishes the GitHub Release
# (electron-updater clients pick it up from there).
#
# Usage: scripts/bump-release.sh <major|minor|patch|dev>
#        (or `pnpm release:major` / `release:minor` / `release:patch` /
#         `release:dev`)
#
# `dev` cuts a DEV RELEASE: a prerelease version (1.11.0-dev.0, then -dev.1,
# …) tagged and published as a GitHub pre-release. Stable installs never see
# it, and the dev build never auto-updates — install it by hand on the
# machines you want to test with, then reinstall a stable release to go back.
# Dev releases may be cut from any branch.

set -euo pipefail

cd "$(dirname "$0")/.."

kind="${1:-}"
case "$kind" in
  major|minor|patch|dev) ;;
  *) echo "usage: $0 <major|minor|patch>" >&2; exit 1 ;;
esac

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree not clean — commit or stash first." >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$kind" != "dev" && "$branch" != "main" ]]; then
  echo "error: releases are cut from main (currently on '$branch')." >&2
  exit 1
fi

# npm edits only the version field and preserves formatting; tagging is ours
# so the commit message and tag match the repo's "release vX.Y.Z" convention.
if [[ "$kind" == "dev" ]]; then
  current="$(node -p "require('./package.json').version")"
  # Already on a dev version → bump its counter; otherwise start a new
  # -dev.0 on the next minor.
  if [[ "$current" == *-dev.* ]]; then
    npm version prerelease --preid dev --no-git-tag-version >/dev/null
  else
    npm version preminor --preid dev --no-git-tag-version >/dev/null
  fi
else
  npm version "$kind" --no-git-tag-version >/dev/null
fi
version="$(node -p "require('./package.json').version")"

git add package.json
if [[ "$kind" == "dev" ]]; then
  git commit -m "chore(release): v$version (dev build)"
else
  git commit -m "release v$version"
fi
git tag "v$version"
# Push branch and tag explicitly — --follow-tags skips lightweight tags, and a
# release where the tag silently stays local never triggers CI.
git push origin HEAD "v$version"

echo "released v$version — CI is building installers (Actions → Release)."
