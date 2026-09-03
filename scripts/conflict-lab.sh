#!/usr/bin/env bash
# Conflict lab — build throwaway repos frozen in exactly the states the
# conflict editor and the auto-fix flows are meant to handle, so each flow can
# be tested in the app in seconds instead of hand-crafting a repo every time.
#
# Usage:
#   ./scripts/conflict-lab.sh                 # build every scenario
#   ./scripts/conflict-lab.sh merge rebase    # only these
#   ./scripts/conflict-lab.sh --list
#   OUT=/tmp/lab ./scripts/conflict-lab.sh    # default OUT=~/Projects/MyProjects/git-gui-test-repos/conflict-lab
#
# Each scenario is its own repo under $OUT/<scenario>/ (plus a bare
# <scenario>-origin.git where a remote is involved). Re-running wipes and
# rebuilds only the scenarios you asked for. Open the repo in Git Gud and do
# what the scenario name says.
#
# Scenarios
#   merge          mid-merge, 3 conflicted files (ts / json / md) with multi-block
#                  conflicts and partially-shared lines → conflict editor
#   rebase         mid-rebase conflict (two commits, first one conflicts) → skip/continue
#   cherry-pick    mid-cherry-pick conflict → panel shows "Cherry-pick", continue/abort
#   revert         mid-revert conflict
#   stash-pop      stash pop that conflicted (unmerged paths, no MERGE_HEAD) → "Stash re-apply"
#   dirty-pull     remote is ahead, local has uncommitted edits to the same file
#                  → Pull auto-fixes: stash, pull, re-apply
#   untracked-pull remote adds a file that exists untracked locally → Pull sets it aside
#   dirty-pull-conflict  like dirty-pull but the re-apply conflicts → stash kept, panel
#   diverged       local and remote both have commits → merge/rebase choice
#   dirty-checkout uncommitted edit that the target branch also changed
#                  → Checkout auto-stashes and offers "Pop stash"
#   dirty-merge    uncommitted edit that the merge would overwrite → Merge auto-fixes
#   dirty-cherry   uncommitted edit that the cherry-pick would overwrite (the commit
#                  to pick is on branch `donor`) → right-click it → Cherry-pick
#   push-rejected  remote moved ahead of local; local has a commit → Push → "Pull now"

set -euo pipefail

OUT="${OUT:-$HOME/Projects/MyProjects/git-gui-test-repos/conflict-lab}"
AUTHOR_NAME="Lab User"
AUTHOR_EMAIL="lab@example.com"

ALL=(merge rebase cherry-pick revert stash-pop dirty-pull untracked-pull dirty-pull-conflict diverged dirty-checkout dirty-merge dirty-cherry push-rejected)

say() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }

if [[ "${1:-}" == "--list" ]]; then printf '%s\n' "${ALL[@]}"; exit 0; fi
WANT=("$@"); [[ ${#WANT[@]} -eq 0 ]] && WANT=("${ALL[@]}")

# ── helpers ────────────────────────────────────────────────────────────────
g() { # g <dir> <git args…>
  local dir="$1"; shift
  GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
  GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
  git -C "$dir" "$@"
}
gq() { g "$@" >/dev/null 2>&1 || true; }   # expected-to-fail ops (conflicts)
init_repo() {
  local dir="$1"
  rm -rf "$dir"; mkdir -p "$dir"
  git -C "$dir" init -q -b main
  git -C "$dir" config user.name "$AUTHOR_NAME"
  git -C "$dir" config user.email "$AUTHOR_EMAIL"
  git -C "$dir" config commit.gpgsign false
  git -C "$dir" config rerere.enabled false
}
w() { # w <dir> <file> <<EOF … EOF   (write stdin to file, mkdir -p)
  mkdir -p "$(dirname "$1/$2")"; cat > "$1/$2"
}
commit() { g "$1" add -A; g "$1" commit -q -m "$2"; }

# Realistic TypeScript file both sides edit. `variant` picks the flavour.
write_app() { # write_app <dir> base|current|incoming
  local dir="$1" v="$2"
  local greet='return `Hello, ${name}!`' retries=3 timeout=1000 log='console.log'
  case "$v" in
    current)  greet='return `Hello, ${name.trim()}!`'; retries=5; log='logger.info' ;;
    incoming) greet='return `Hi ${name}, welcome back`'; timeout=2500; log='logger.debug' ;;
  esac
  w "$dir" src/app.ts <<EOF
import { logger } from './logger'

export interface Options {
  retries: number
  timeout: number
}

export const defaults: Options = {
  retries: $retries,
  timeout: $timeout,
}

export function greet(name: string): string {
  $log('greet called')
  $greet
}

export async function fetchWithRetry(url: string, opts: Options = defaults): Promise<Response> {
  let lastError: unknown
  for (let i = 0; i < opts.retries; i++) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(opts.timeout) })
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}
EOF
}
write_pkg() { # write_pkg <dir> base|current|incoming
  local dir="$1" v="$2" version='"1.0.0"' desc='"Lab app"' extra=''
  case "$v" in
    current)  version='"1.1.0"'; extra='    "lint": "eslint .",'$'\n' ;;
    incoming) version='"2.0.0"'; desc='"Lab app — rewritten"' ;;
  esac
  w "$dir" package.json <<EOF
{
  "name": "lab-app",
  "version": $version,
  "description": $desc,
  "scripts": {
    "build": "tsc",
$extra    "test": "vitest"
  }
}
EOF
}
write_readme() { # write_readme <dir> base|current|incoming
  local dir="$1" v="$2" install='pnpm install' note=''
  case "$v" in
    current)  install='pnpm install --ignore-scripts'; note='Run `pnpm test` before pushing.' ;;
    incoming) install='npm ci'; note='CI runs the tests for you.' ;;
  esac
  w "$dir" README.md <<EOF
# Lab app

## Install

\`\`\`sh
$install
\`\`\`

## Notes

$note

## Contributing

Open a pull request against main.

## License

MIT
EOF
}

# Two branches, `main` (current) and `topic` (incoming), that conflict in the
# three files above. Leaves the repo on main with topic ready to merge/rebase.
seed_conflicting_branches() {
  local dir="$1"
  init_repo "$dir"
  write_app "$dir" base; write_pkg "$dir" base; write_readme "$dir" base
  w "$dir" src/logger.ts <<'EOF'
export const logger = { info: console.log, debug: console.debug }
EOF
  commit "$dir" "init: lab app"
  g "$dir" checkout -q -b topic
  write_app "$dir" incoming; write_pkg "$dir" incoming; write_readme "$dir" incoming
  commit "$dir" "topic: greeting copy, timeout bump, npm ci"
  w "$dir" src/extra.ts <<'EOF'
export const extra = true
EOF
  commit "$dir" "topic: add extra module"
  g "$dir" checkout -q main
  write_app "$dir" current; write_pkg "$dir" current; write_readme "$dir" current
  commit "$dir" "main: trim names, more retries, lint script"
}

# Repo + bare origin where origin/main is one commit ahead (edits src/app.ts
# and adds notes.txt). Leaves the local clone on main, fetched, not pulled.
seed_remote_ahead() {
  local dir="$1" origin="$1-origin.git"
  rm -rf "$origin"; git init -q --bare -b main "$origin"
  init_repo "$dir"
  write_app "$dir" base; write_readme "$dir" base
  commit "$dir" "init: lab app"
  g "$dir" remote add origin "$origin"
  g "$dir" push -q -u origin main
  local tmp="$dir-pusher"; rm -rf "$tmp"
  git clone -q "$origin" "$tmp"
  git -C "$tmp" config user.name "$AUTHOR_NAME"; git -C "$tmp" config user.email "$AUTHOR_EMAIL"
  write_app "$tmp" incoming
  echo "landed on origin" > "$tmp/notes.txt"
  commit "$tmp" "origin: greeting copy + notes"
  g "$tmp" push -q origin main
  rm -rf "$tmp"
  g "$dir" fetch -q origin
}

mkdir -p "$OUT"
for s in "${WANT[@]}"; do
  R="$OUT/$s"
  case "$s" in
    merge)
      say "merge — mid-merge, 3 conflicted files"
      seed_conflicting_branches "$R"
      gq "$R" merge topic
      ;;
    rebase)
      say "rebase — mid-rebase, first replayed commit conflicts"
      seed_conflicting_branches "$R"
      g "$R" checkout -q topic
      gq "$R" rebase main
      ;;
    cherry-pick)
      say "cherry-pick — mid-cherry-pick conflict"
      seed_conflicting_branches "$R"
      gq "$R" cherry-pick topic~1
      ;;
    revert)
      say "revert — mid-revert conflict"
      seed_conflicting_branches "$R"
      # main's last commit rewrote the greeting lines (base → current); a newer
      # commit rewrites them again (→ incoming). Reverting the older one has
      # to undo text that no longer exists → conflict.
      write_app "$R" incoming; commit "$R" "main: rewrite greeting again"
      gq "$R" revert --no-edit HEAD~1
      ;;
    stash-pop)
      say "stash-pop — stash re-apply conflicted (no MERGE_HEAD)"
      init_repo "$R"
      write_app "$R" base; commit "$R" "init"
      write_app "$R" incoming; g "$R" stash push -q -m "lab: my WIP"
      write_app "$R" current; commit "$R" "main: competing edit"
      gq "$R" stash pop
      ;;
    dirty-pull)
      say "dirty-pull — remote ahead, local uncommitted edit → Pull auto-fixes (clean re-apply)"
      seed_remote_ahead "$R"
      # Uncommitted edit in a file origin changed, but on lines far from
      # origin's edit → git refuses the pull, yet the re-apply merges cleanly.
      sed -i.bak 's/  throw lastError$/  throw lastError ?? new Error("unreachable")/' "$R/src/app.ts" && rm -f "$R/src/app.ts.bak"
      ;;
    untracked-pull)
      say "untracked-pull — remote adds notes.txt, local has an untracked notes.txt"
      seed_remote_ahead "$R"
      echo "my local scratch notes" > "$R/notes.txt"
      ;;
    dirty-pull-conflict)
      say "dirty-pull-conflict — re-applying the stash after pull conflicts"
      seed_remote_ahead "$R"
      # Same lines as origin's edit but different text → pop conflicts.
      sed -i.bak 's/return `Hello, ${name}!`/return `Yo ${name}`/' "$R/src/app.ts" && rm -f "$R/src/app.ts.bak"
      ;;
    diverged)
      say "diverged — local and remote both have commits"
      seed_remote_ahead "$R"
      w "$R" local.txt <<<"only local"; commit "$R" "local: add local.txt"
      ;;
    dirty-checkout)
      say "dirty-checkout — uncommitted edit collides with branch topic"
      seed_conflicting_branches "$R"
      write_readme "$R" incoming   # uncommitted edit to a file topic changed
      ;;
    dirty-merge)
      say "dirty-merge — uncommitted edit that merging topic would overwrite"
      seed_conflicting_branches "$R"
      # main adopts topic's app.ts/package.json so the merge itself is clean;
      # README still differs, and an uncommitted edit far from topic's README
      # change makes git refuse — auto-fix stashes, merges, re-applies cleanly.
      write_app "$R" incoming; write_pkg "$R" incoming; write_readme "$R" base
      commit "$R" "main: adopt topic's app + package, reset README (merge is now clean)"
      sed -i.bak 's/^MIT$/Apache-2.0/' "$R/README.md" && rm -f "$R/README.md.bak"
      ;;
    dirty-cherry)
      say "dirty-cherry — uncommitted edit that cherry-picking from donor would overwrite"
      init_repo "$R"
      write_app "$R" base; commit "$R" "init"
      g "$R" checkout -q -b donor
      echo "donor line" > "$R/donor.txt"; write_readme "$R" incoming
      commit "$R" "donor: add donor.txt + readme"
      g "$R" checkout -q main
      sed -i.bak 's/^MIT$/Apache-2.0/' "$R/README.md" && rm -f "$R/README.md.bak"   # far from donor's README change → clean re-apply
      ;;
    push-rejected)
      say "push-rejected — remote moved on, local has a commit to push"
      seed_remote_ahead "$R"
      w "$R" local.txt <<<"only local"; commit "$R" "local: add local.txt"
      ;;
    *) echo "unknown scenario: $s" >&2; exit 1 ;;
  esac
done

cat <<EOF

════════════════════════════════════════════════════════════════════════════
Conflict lab built in: $OUT
════════════════════════════════════════════════════════════════════════════
Open a scenario folder in Git Gud (File › Open, or drag it onto the window):

$(for s in "${WANT[@]}"; do printf '  %-22s %s\n' "$s" "$OUT/$s"; done)

Rebuild one scenario any time:  pnpm lab <scenario>
List scenarios:                 pnpm lab -- --list
EOF
