#!/usr/bin/env bash
# Uploads every episode not yet in youtube.json, in order, as its render appears. When YouTube
# answers uploadLimitExceeded (a new channel's daily cap), waits and tries again.
#
#   NEON_HOME=~/.neon-video-yt video/tools/upload-queue.sh     # with that instance signed in
set -uo pipefail
cd "$(dirname "$0")/.."
WAIT="${WAIT:-1800}"
for e in $(ls episodes | sed 's/\.json$//'); do
  grep -q "\"$e\"" youtube.json 2>/dev/null && continue
  until [ -f "build/renders/$e.mp4" ] && ! grep -q "== $e" <(tail -1 /tmp/gg-render.log 2>/dev/null); do sleep 30; done
  [ -f "build/thumbs/$e.png" ] || node tools/youtube.ts thumbs "$e" || exit 1
  while true; do
    out=$(node tools/youtube.ts upload "$e" 2>&1)
    if grep -q "youtu.be" <<<"$out"; then echo "$(date +%H:%M) $(grep youtu.be <<<"$out" | tail -1)"; break; fi
    if grep -q "uploadLimitExceeded" <<<"$out"; then echo "$(date +%H:%M) $e: daily upload limit, waiting ${WAIT}s"; sleep "$WAIT"; continue; fi
    echo "$(date +%H:%M) $e failed:"; echo "$out" | grep -v "^    at" | tail -5; exit 1
  done
done
echo "$(date +%H:%M) all uploaded"
