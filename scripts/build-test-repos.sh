#!/usr/bin/env bash
# Build a sandbox of git repositories that exercise the operations git-gui
# supports: branching, merging, rebasing, cherry-pick, stash, worktree,
# tags, remotes (fetch/pull/push to a local bare repo), hard reset, bisect,
# patches, and conflict resolution.
#
# Usage:
#   ./scripts/build-test-repos.sh              # default OUT=~/Projects/MyProjects/git-gui-test-repos
#   OUT=/tmp/grepo ./scripts/build-test-repos.sh
#
# Re-running wipes and rebuilds OUT — repos are throwaway by design.

set -euo pipefail

OUT="${OUT:-$HOME/Projects/MyProjects/git-gui-test-repos}"
AUTHOR_NAME="Test User"
AUTHOR_EMAIL="test@example.com"
DATE_BASE=$(date -u +%s)   # epoch we walk forward from per commit

say() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }

# ── Helpers ───────────────────────────────────────────────────────────────────

# Run `git` in a repo dir; sets identity + a deterministic-ish date that
# advances per call so commits don't all share the same timestamp.
COMMIT_TICK=0
git_in() {
  local dir="$1"; shift
  GIT_AUTHOR_NAME="$AUTHOR_NAME" \
  GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
  GIT_COMMITTER_NAME="$AUTHOR_NAME" \
  GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
  git -C "$dir" "$@"
}

# Bump tick and stamp the next commit. Each tick = +60s so the timeline
# stays linear and readable in the graph.
commit_in() {
  local dir="$1"; local msg="$2"
  COMMIT_TICK=$((COMMIT_TICK + 60))
  local ts=$((DATE_BASE + COMMIT_TICK))
  local iso
  iso=$(date -u -r "$ts" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "@$ts" +"%Y-%m-%dT%H:%M:%SZ")
  GIT_AUTHOR_DATE="$iso" GIT_COMMITTER_DATE="$iso" \
  GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
  GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
  git -C "$dir" commit -q -m "$msg"
}

init_repo() {
  local dir="$1"
  mkdir -p "$dir"
  git -C "$dir" init -q -b main
  git -C "$dir" config user.name "$AUTHOR_NAME"
  git -C "$dir" config user.email "$AUTHOR_EMAIL"
  git -C "$dir" config commit.gpgsign false
}

# Append a line to a file then stage it. Creates the file if missing.
append() {
  local dir="$1"; local file="$2"; local line="$3"
  mkdir -p "$(dirname "$dir/$file")"
  printf '%s\n' "$line" >> "$dir/$file"
  git -C "$dir" add "$file"
}

# Overwrite a file (then stage).
write_file() {
  local dir="$1"; local file="$2"; local content="$3"
  mkdir -p "$(dirname "$dir/$file")"
  printf '%s' "$content" > "$dir/$file"
  git -C "$dir" add "$file"
}

# ── Reset output dir ──────────────────────────────────────────────────────────

if [[ -e "$OUT" ]]; then
  say "Wiping existing $OUT"
  rm -rf "$OUT"
fi
mkdir -p "$OUT"

# ════════════════════════════════════════════════════════════════════════════
# 1. alpha-origin.git + alpha — main repo: history, branches, tags, stashes,
#    a remote, worktrees, dirty working tree, conflict-ready branch.
# ════════════════════════════════════════════════════════════════════════════

say "Building alpha (full-feature playground) + alpha-origin.git (bare remote)"

ORIGIN="$OUT/alpha-origin.git"
ALPHA="$OUT/alpha"

git init -q --bare -b main "$ORIGIN"
init_repo "$ALPHA"

# Seed main with a steady stream of commits
write_file "$ALPHA" README.md "# Alpha\n\nPlayground repo.\n"
commit_in "$ALPHA" "init: scaffold README"

for i in 1 2 3 4 5; do
  append "$ALPHA" "src/app.ts" "export const step$i = $i;"
  commit_in "$ALPHA" "feat: add step $i"
done

git_in "$ALPHA" tag -a v0.1 -m "v0.1 — early seed"

for i in 6 7 8; do
  append "$ALPHA" "src/app.ts" "export const step$i = $i;"
  commit_in "$ALPHA" "feat: add step $i"
done

git_in "$ALPHA" tag -a v0.2 -m "v0.2 — pre-feature"

# feature/login — branched off v0.2, mergeable
git_in "$ALPHA" checkout -q -b feature/login
write_file "$ALPHA" src/login.ts "export function login() { return true; }"
commit_in "$ALPHA" "feat(login): scaffold login()"
append "$ALPHA" src/login.ts "export function logout() { return true; }"
commit_in "$ALPHA" "feat(login): add logout()"
append "$ALPHA" src/login.ts "// telemetry hook"
commit_in "$ALPHA" "chore(login): telemetry hook"

# feature/cart — branched off v0.2, will be behind main (rebase candidate)
git_in "$ALPHA" checkout -q v0.2
git_in "$ALPHA" checkout -q -b feature/cart
write_file "$ALPHA" src/cart.ts "export const cart: string[] = [];"
commit_in "$ALPHA" "feat(cart): scaffold cart"
append "$ALPHA" src/cart.ts "export function addToCart(x: string) { cart.push(x); }"
commit_in "$ALPHA" "feat(cart): add addToCart"

# Back to main: keep advancing so feature/cart needs rebase
git_in "$ALPHA" checkout -q main
for i in 9 10; do
  append "$ALPHA" "src/app.ts" "export const step$i = $i;"
  commit_in "$ALPHA" "feat: add step $i"
done

# Merge feature/login into main (real merge commit)
git_in "$ALPHA" merge --no-ff feature/login -m "Merge feature/login"

# hotfix/perf — short branch, cherry-pick candidate
git_in "$ALPHA" checkout -q -b hotfix/perf
write_file "$ALPHA" src/perf.ts "export const perfFix = true;"
commit_in "$ALPHA" "fix(perf): hot path"
append "$ALPHA" src/perf.ts "// follow-up"
commit_in "$ALPHA" "chore(perf): follow-up"

git_in "$ALPHA" checkout -q main
for i in 11 12 13; do
  append "$ALPHA" "src/app.ts" "export const step$i = $i;"
  commit_in "$ALPHA" "feat: add step $i"
done

git_in "$ALPHA" tag -a v1.0 -m "v1.0 — first big release"

# feature/conflict — touches the SAME line as main next, will conflict on merge/rebase
git_in "$ALPHA" checkout -q v1.0
git_in "$ALPHA" checkout -q -b feature/conflict
# Replace step1 line with feature variant
sed_inplace() {
  if sed --version >/dev/null 2>&1; then sed -i "$@"; else sed -i '' "$@"; fi
}
sed_inplace 's/step1 = 1;/step1 = 100; \/\/ feature variant/' "$ALPHA/src/app.ts"
git_in "$ALPHA" add src/app.ts
commit_in "$ALPHA" "feat(conflict): override step1"

# Advance main with a competing change on the same line
git_in "$ALPHA" checkout -q main
sed_inplace 's/step1 = 1;/step1 = -1; \/\/ main variant/' "$ALPHA/src/app.ts"
git_in "$ALPHA" add src/app.ts
commit_in "$ALPHA" "fix: invert step1 on main"

# A few more main commits so the graph stays interesting
for i in 14 15; do
  append "$ALPHA" "src/app.ts" "export const step$i = $i;"
  commit_in "$ALPHA" "feat: add step $i"
done

# ── Stashes ─────────────────────────────────────────────────────────────────
# Three stashes: clean WIP, one with a message, one with an untracked file
echo "// scratch idea 1" >> "$ALPHA/src/app.ts"
git_in "$ALPHA" stash push -q -m "scratch: idea 1"

echo "// scratch idea 2" >> "$ALPHA/src/app.ts"
git_in "$ALPHA" stash push -q   # auto "WIP on main" message

echo "draft notes here" > "$ALPHA/NOTES.txt"
git_in "$ALPHA" stash push -q -u -m "scratch: notes (with untracked)"

# ── Remote: bare origin ─────────────────────────────────────────────────────
git_in "$ALPHA" remote add origin "$ORIGIN"
git_in "$ALPHA" push -q --all origin
git_in "$ALPHA" push -q --tags origin
git_in "$ALPHA" branch --set-upstream-to=origin/main main 2>/dev/null || true

# Diverge main from origin so push/pull/fetch show non-trivial state:
#  - One unpushed local commit on main
#  - Reset origin's main back by one to simulate "behind"
append "$ALPHA" "src/app.ts" "// only on local"
commit_in "$ALPHA" "chore: local-only tweak (unpushed)"

# Move origin/main one commit behind by force-pushing main^ (simulates remote
# that drifted ahead from somewhere else — actually we keep origin "behind"
# here; for a "behind" remote we'd need an extra commit on origin. Done below.)

# Simulate origin having a commit we don't have yet → "behind"
TMP_CLONE="$OUT/.alpha-origin-clone"
git clone -q "$ORIGIN" "$TMP_CLONE"
git -C "$TMP_CLONE" config user.name "$AUTHOR_NAME"
git -C "$TMP_CLONE" config user.email "$AUTHOR_EMAIL"
echo "// landed via origin push" >> "$TMP_CLONE/src/app.ts"
git -C "$TMP_CLONE" add src/app.ts
GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
git -C "$TMP_CLONE" commit -q -m "chore: landed on origin (you need to pull)"
git -C "$TMP_CLONE" push -q origin main
rm -rf "$TMP_CLONE"

# Fetch so alpha sees origin/main has advanced → ahead 1 / behind 1
git_in "$ALPHA" fetch -q origin

# ── Worktrees ───────────────────────────────────────────────────────────────
# Two extra worktrees so the worktree UI has something to chew on.
git_in "$ALPHA" worktree add -q "$OUT/alpha.worktrees/cart"   feature/cart   2>/dev/null || true
git_in "$ALPHA" worktree add -q "$OUT/alpha.worktrees/hotfix" hotfix/perf    2>/dev/null || true

# ── Dirty working tree ──────────────────────────────────────────────────────
# Mix: staged add, staged modify, unstaged modify, untracked
echo "// staged new line" >> "$ALPHA/src/app.ts"
git_in "$ALPHA" add src/app.ts
echo "// unstaged on top" >> "$ALPHA/src/app.ts"
echo "TODO: not yet tracked" > "$ALPHA/TODO.txt"

# ════════════════════════════════════════════════════════════════════════════
# 2. bisect-lab — linear history with a single "BUG" commit for `git bisect`.
# ════════════════════════════════════════════════════════════════════════════

say "Building bisect-lab (linear history with one planted bug)"

BISECT="$OUT/bisect-lab"
init_repo "$BISECT"
write_file "$BISECT" calc.js "function add(a,b){ return a + b; }\nmodule.exports = { add };\n"
commit_in "$BISECT" "init: add()"

for i in 1 2 3 4 5 6 7; do
  append "$BISECT" calc.js "// note $i"
  commit_in "$BISECT" "chore: note $i"
done

# Plant the bug: subtraction where addition was expected
write_file "$BISECT" calc.js "function add(a,b){ return a - b; }\nmodule.exports = { add };\n"
commit_in "$BISECT" "feat: optimize add (BUG: returns a-b instead)"

for i in 8 9 10 11 12 13 14 15; do
  append "$BISECT" calc.js "// note $i"
  commit_in "$BISECT" "chore: note $i"
done

# Test scaffold the user can wire into `git bisect run`
write_file "$BISECT" test.js \
  'const { add } = require("./calc.js"); process.exit(add(2,3) === 5 ? 0 : 1);'
git_in "$BISECT" commit -q -m "test: add() should return 5 for (2,3)"

# ════════════════════════════════════════════════════════════════════════════
# 3. patch-lab — small repo for testing format-patch / am / apply.
# ════════════════════════════════════════════════════════════════════════════

say "Building patch-lab (small repo for patch round-trips)"

PATCH="$OUT/patch-lab"
init_repo "$PATCH"
write_file "$PATCH" app.py "def greet(name):\n    return f'Hello, {name}'\n"
commit_in "$PATCH" "init: greet()"

git_in "$PATCH" checkout -q -b feature/yell
write_file "$PATCH" app.py "def greet(name):\n    return f'HELLO, {name.upper()}!'\n"
commit_in "$PATCH" "feat: shout the greeting"
append "$PATCH" app.py "# extra polish"
commit_in "$PATCH" "chore: polish"

git_in "$PATCH" checkout -q main

# Pre-generate two patches so the user can practice `git apply` / `git am`
mkdir -p "$PATCH/.patches"
git_in "$PATCH" format-patch -q -o .patches main..feature/yell >/dev/null

# ════════════════════════════════════════════════════════════════════════════
# 4. graph-lab — commit-graph lane rendering. Two topologies that the lane
#    allocator used to get wrong (see BUG_LIST.md):
#      A. siblings sharing a parent, with an unrelated tip dated between them
#         → the unrelated tip used to land IN the sibling's fork lane, with the
#           fork line drawn straight through its node (a parent/child link that
#           does not exist)
#      B. a trunk pushed outboard by two branch tips that then end
#         → the trunk used to stay stranded in the outer lane forever, with the
#           inner columns sitting empty all the way to the root
#    Commit dates are explicit because the graph is laid out in --date-order:
#    the interleaving IS the test.
# ════════════════════════════════════════════════════════════════════════════

say "Building graph-lab-false-edge + graph-lab-stranded-lane"

# Commit into $1 on an explicit date. The graph is laid out in --date-order,
# so the dates ARE the test — they decide which row each commit lands on.
gcommit() {
  local dir="$1"; local day="$2"; local msg="$3"
  write_file "$dir" "c${day}.txt" "$msg"
  GIT_AUTHOR_DATE="2026-03-${day}T12:00:00Z" GIT_COMMITTER_DATE="2026-03-${day}T12:00:00Z" \
  GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
  GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
  git -C "$dir" commit -q -m "$msg"
}

# ── 4a. graph-lab-false-edge ───────────────────────────────────────────────
# Two siblings share a parent. The first claims the parent's column; the second
# has to fork back into it, and that fork is drawn as a vertical run down the
# SECOND sibling's own column. An unrelated tip dated between them used to be
# handed that column — putting its node right on the line, which reads as a
# parent/child link that does not exist.
FALSE_EDGE="$OUT/graph-lab-false-edge"
init_repo "$FALSE_EDGE"

gcommit "$FALSE_EDGE" 01 "root of the unrelated branch"
git_in "$FALSE_EDGE" branch drifter
gcommit "$FALSE_EDGE" 02 "shared parent of both siblings"

git_in "$FALSE_EDGE" checkout -q -b sibling/one
gcommit "$FALSE_EDGE" 05 "sibling one (claims the shared parent's lane)"

git_in "$FALSE_EDGE" checkout -q -b sibling/two main
gcommit "$FALSE_EDGE" 06 "sibling two (forks back to the shared parent)"

git_in "$FALSE_EDGE" checkout -q drifter
gcommit "$FALSE_EDGE" 04 "UNRELATED tip — must not sit on the fork line"
git_in "$FALSE_EDGE" checkout -q main

# ── 4b. graph-lab-stranded-lane ────────────────────────────────────────────
# Two branches off a shared base, both merged back into main. The second merge
# parent's chain reaches the base first and claims an outer column for it, so
# the whole remaining trunk used to inherit that outer column and keep it all
# the way to the root — with the inner columns sitting visibly empty.
STRANDED="$OUT/graph-lab-stranded-lane"
init_repo "$STRANDED"

gcommit "$STRANDED" 01 "trunk: root"
gcommit "$STRANDED" 02 "trunk: second"
gcommit "$STRANDED" 03 "trunk: third"
gcommit "$STRANDED" 04 "trunk: fourth"
gcommit "$STRANDED" 05 "shared base of both feature branches"

# The feature commits are dated AFTER the mainline commit, so they sit above it
# in --date-order and their chain reaches the shared base first. That is what
# hands the base an outer column.
git_in "$STRANDED" checkout -q main
gcommit "$STRANDED" 06 "trunk: mainline work alongside the features"

git_in "$STRANDED" checkout -q -b feature/two main~1
gcommit "$STRANDED" 07 "feature two: the work"
git_in "$STRANDED" checkout -q -b feature/one main~1
gcommit "$STRANDED" 08 "feature one: the work"

git_in "$STRANDED" checkout -q main
GIT_AUTHOR_DATE="2026-03-09T12:00:00Z" GIT_COMMITTER_DATE="2026-03-09T12:00:00Z" \
  git_in "$STRANDED" merge -q --no-ff -m "Merge feature/two" feature/two
GIT_AUTHOR_DATE="2026-03-10T12:00:00Z" GIT_COMMITTER_DATE="2026-03-10T12:00:00Z" \
  git_in "$STRANDED" merge -q --no-ff -m "Merge feature/one" feature/one
gcommit "$STRANDED" 11 "trunk: latest"

# ════════════════════════════════════════════════════════════════════════════
# 5. lock-lab — a repo wedged by a stale .git/index.lock, as a crashed git
#    process would leave it. Staging anything must offer "Remove Lock & Retry"
#    instead of dead-ending on git's fatal.
# ════════════════════════════════════════════════════════════════════════════

say "Building lock-lab (stale index.lock)"

LOCK="$OUT/lock-lab"
init_repo "$LOCK"
write_file "$LOCK" README.md "# Lock lab\n\nStaging here hits a stale index.lock.\n"
commit_in "$LOCK" "init"
echo "edit me" > "$LOCK/needs-staging.txt"
# The stale lock itself — no git process owns it, exactly the crashed-process case.
: > "$LOCK/.git/index.lock"

# ════════════════════════════════════════════════════════════════════════════
# 6. solo — minimal pristine repo (a "fresh start" target).
# ════════════════════════════════════════════════════════════════════════════

say "Building solo (minimal clean repo)"

SOLO="$OUT/solo"
init_repo "$SOLO"
write_file "$SOLO" README.md "# Solo\n\nA single commit, nothing to see.\n"
commit_in "$SOLO" "init"

# ════════════════════════════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════════════════════════════

cat <<EOF


════════════════════════════════════════════════════════════════════════════
Built in: $OUT
════════════════════════════════════════════════════════════════════════════

alpha/                        ← open this one first
  · main, feature/login (merged), feature/cart (behind main),
    hotfix/perf (cherry-pick candidate), feature/conflict (rebase conflict)
  · tags: v0.1, v0.2, v1.0 (annotated)
  · 3 stashes (one with untracked file)
  · origin → ../alpha-origin.git, main is ahead 1 / behind 1
  · 2 extra worktrees in alpha.worktrees/ (cart, hotfix)
  · dirty working tree: staged + unstaged + untracked

alpha-origin.git/             bare remote backing alpha

bisect-lab/                   for git bisect
  · 16 linear commits, bug planted at "feat: optimize add (BUG: …)"
  · test.js fails for the buggy commit → wire into 'git bisect run node test.js'

patch-lab/                    for format-patch / am / apply
  · main + feature/yell
  · pre-built patches in .patches/

solo/                         minimal pristine repo

Things to try in the app:
  ✓ Checkout / switch between branches & worktrees
  ✓ Rebase feature/cart onto main          (behind, clean rebase)
  ✓ Merge or rebase feature/conflict       (will conflict on src/app.ts)
  ✓ Cherry-pick from hotfix/perf onto main
  ✓ Stash apply / pop / drop               (3 sitting on alpha)
  ✓ Tag create / delete                    (v0.1/v0.2/v1.0 exist)
  ✓ Hard reset main back to v1.0 in alpha
  ✓ Fetch / pull (origin has one commit you don't)
  ✓ Push (you have one local-only commit)
  ✓ Create + apply patches (patch-lab/.patches)
  ✓ Bisect across bisect-lab to find the planted bug
  ✓ Stage / unstage individual lines in the dirty alpha tree

Rebuild any time:
  $ ./scripts/build-test-repos.sh
  $ OUT=/tmp/grepo ./scripts/build-test-repos.sh
EOF
