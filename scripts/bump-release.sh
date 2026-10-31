#!/usr/bin/env bash
# One-click release. main only takes changes through pull requests, so a
# stable release bumps package.json on a release/vX.Y.Z branch, opens and
# merges a "release vX.Y.Z" PR, then tags the merged commit on main and pushes
# the tag. The pushed tag triggers .github/workflows/release.yml, which builds
# the installers and publishes the GitHub Release (electron-updater clients
# pick it up from there). Needs an authenticated `gh`.
#
# Usage: scripts/bump-release.sh <major|minor|patch|dev>
#        (or `pnpm release:major` / `release:minor` / `release:patch` /
#         `release:dev`)
#
# `dev` cuts a DEV RELEASE: a prerelease version (1.11.0-dev.0, then -dev.1,
# …) tagged and published as a GitHub pre-release. Stable installs never see
# it, and the dev build never auto-updates — install it by hand on the
# machines you want to test with, then reinstall a stable release to go back.
# Dev releases are cut from a feature branch: the bump commit rides along on
# that branch and reaches main with its PR.

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
if [[ "$kind" == "dev" && "$branch" == "main" ]]; then
  echo "error: main only takes PRs — cut dev releases from a feature branch." >&2
  exit 1
fi
if [[ "$kind" != "dev" ]]; then
  git fetch --quiet origin main
  if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
    echo "error: local main is not origin/main — pull first." >&2
    exit 1
  fi
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
  git tag "v$version"
  # Push branch and tag explicitly — --follow-tags skips lightweight tags, and
  # a release where the tag silently stays local never triggers CI.
  git push origin HEAD "v$version"
  echo "released v$version — CI is building installers (Actions → Release)."
  exit 0
fi

release_branch="release/v$version"
git switch --quiet -c "$release_branch"
git commit -m "release v$version"
git push --quiet -u origin "$release_branch"
gh pr create --base main --head "$release_branch" \
  --title "release v$version" --body "Bumps package.json to $version. Merging tags v$version."
gh pr merge "$release_branch" --squash --delete-branch --subject "release v$version" --body ""

git switch --quiet main
git pull --quiet --ff-only origin main
merged="$(node -p "require('./package.json').version")"
if [[ "$merged" != "$version" ]]; then
  echo "error: main is at $merged after the merge, expected $version — not tagging." >&2
  exit 1
fi
git tag "v$version"
git push origin "v$version"

echo "released v$version — CI is building installers (Actions → Release)."
