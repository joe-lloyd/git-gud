#!/usr/bin/env bash
# Loads .env (if present), builds, and publishes installers to GitHub
# Releases via electron-builder. Used by `pnpm release` so secrets stay
# out of your shell history and out of CLI args.
#
# Expected .env contents:
#   GH_TOKEN=ghp_…
# .env is gitignored — never commit it.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  # `set -a` auto-exports every var set until `set +a`, so anything in .env
  # ends up in the environment electron-builder reads.
  set -a
  # shellcheck source=/dev/null
  source .env
  set +a
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "error: GH_TOKEN is not set. Add it to .env or export it before running." >&2
  exit 1
fi

pnpm build
pnpm exec electron-builder --publish always
