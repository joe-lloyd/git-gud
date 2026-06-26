## 1. Fix conflict-state detection (main)

- [x] 1.1 `getConflictState` now resolves control files via `git rev-parse --git-path MERGE_HEAD | rebase-merge | rebase-apply` (cwd=repoPath), then `fs.access` — removed the hardcoded `‹repo›/.git/…` assumption.
- [x] 1.2 `rebaseKind` derived from which of `rebase-merge` / `rebase-apply` resolves; kept the `git diff --name-only --diff-filter=U` conflicted-file list.
- [x] 1.3 Relative `--git-path` results are resolved against `repoPath`; absolute results used as-is.

## 2. Verify the takeover + resolver wiring (renderer)

- [x] 2.1 `ConflictPanel` confirmed first in the right-panel conditional (above bisect/patch/working-tree/multi-select/commit-detail); conflict bar present.
- [x] 2.2 Selecting a conflicted file opens `ConflictEditor` in the center; the `activeConflictFile` auto-close effect fires when the file resolves or the op ends.
- [x] 2.3 Continue (gated on all-resolved), skip (rebase), abort (in-app confirm) operate and report failures — unchanged and intact.

## 3. Lock it down

- [x] 3.1 Backend regression test: a conflicting rebase **inside a worktree** is reported `inRebase: true` with the conflicted file (the regressed case).
- [x] 3.2 Backend tests: merge conflict in a normal repo reports `inMerge`; a clean repo reports no conflict.
- [x] 3.3 `pnpm typecheck`, `pnpm build`, `pnpm test --run` pass (65 tests / 10 files).

## 4. Verification

- [ ] 4.1 (manual) Pause a rebase on a conflict in a normal repo → right panel takes over, resolver opens, continue/abort work.
- [ ] 4.2 (manual) Same inside a worktree → takeover now appears (the regressed case).
