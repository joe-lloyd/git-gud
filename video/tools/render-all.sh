#!/usr/bin/env bash
# Builds and renders every episode in turn: video/build/renders/<episode>.mp4
set -uo pipefail
cd "$(dirname "$0")/.."
for e in $(ls episodes | sed 's/\.json$//'); do
  if [[ $# -gt 0 && ! " $* " =~ " $e " ]]; then continue; fi
  echo "== $e $(date +%H:%M:%S)"
  node tools/edit.ts "$e" --render 2>&1 | tail -2
done
echo "== done $(date +%H:%M:%S)"
