## Why

When a merge or rebase pauses on conflicts, the user needs the right panel to take over and walk them through resolution — list the conflicted files, open the in-app resolver, and offer continue / skip / abort. The wiring for this exists (`ConflictPanel`, `ConflictEditor`), but it silently fails to appear in some setups, most notably **worktrees**: conflict detection hardcodes `‹repo›/.git/rebase-merge` etc., yet in a worktree `.git` is a *file* and the rebase/merge state lives under `‹main-gitdir›/worktrees/‹name›/`. So `inRebase`/`inMerge` come back false, the takeover never triggers, and the resolver is unreachable — the user is stuck mid-rebase with no UI. This restores the takeover, makes detection robust, and specs the behavior so a future refactor can't quietly drop it again.

## What Changes

- **Fix conflict-state detection** to resolve git's control files via `git rev-parse --git-path <file>` instead of assuming `‹repo›/.git/…`, so `MERGE_HEAD` / `rebase-merge` / `rebase-apply` are found in worktrees, submodules, and any non-standard git-dir layout.
- **Guarantee the right-panel takeover**: while a merge or rebase is in progress, the right panel shows the conflict panel with the highest precedence (above working-tree / commit-detail / multi-select), and the top conflict bar reflects the state.
- **Restore resolver access**: selecting a conflicted file opens the in-app resolver (`ConflictEditor`) in the center; continue / skip / abort operate from the panel; resolving a file (staging) updates the list and the editor closes when its file is no longer conflicted.
- **Lock it down**: write the `conflict-resolution` capability spec (WHEN/THEN) and add a regression test for worktree-aware conflict detection so the takeover can't silently regress.

## Capabilities

### New Capabilities
- `conflict-resolution`: worktree-safe detection of in-progress merge/rebase + conflicted files; the right-panel takeover during conflict; the resolver flow (open a conflicted file, edit/take-side, save & mark resolved); and continue/skip/abort with conflict-aware results.

### Modified Capabilities
<!-- None — there is no existing conflict spec in openspec/specs/. -->

## Impact

- **Main** (`src/main/git-service.ts`): rewrite `getConflictState` to use `git rev-parse --git-path` for `MERGE_HEAD`, `rebase-merge`, `rebase-apply` (and derive `rebaseKind`); keep `git diff --diff-filter=U` for the conflicted-file list (already cwd-correct in worktrees).
- **Renderer** (`src/renderer/App.tsx`): confirm/keep the right-panel precedence (`ConflictPanel` first) and the `activeConflictFile` → `ConflictEditor` wiring; the conflict bar.
- **Components**: `ConflictPanel` (continue/skip/abort, file list) and `ConflictEditor` (resolver) are reused as-is.
- **Tests** (`test/backend/`): a regression test that a rebase paused on a conflict **inside a worktree** is reported as `inRebase: true` with the conflicted files — the exact case that was failing.
- No new dependencies.
