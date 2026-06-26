## Context

The conflict UI already exists end to end: `getConflictState` (main) populates `RepoStatus.conflict`; `App.tsx` renders a top conflict bar and gives `ConflictPanel` top precedence in the right panel; `ConflictPanel` lists conflicted files + continue/skip/abort; selecting a file sets `activeConflictFile`, which renders `ConflictEditor` (the resolver) in the center. The break is upstream of all that: `getConflictState` looks for `‹repoPath›/.git/MERGE_HEAD | rebase-merge | rebase-apply`. In a linked worktree, `‹worktree›/.git` is a *file* pointing at `‹main-gitdir›/worktrees/‹name›`, and the in-progress state lives there — so those `fs.access` checks fail and the whole takeover never fires.

## Goals / Non-Goals

**Goals:**
- Conflict detection that is correct in worktrees and any non-standard git-dir layout.
- A guaranteed, highest-precedence right-panel takeover during merge/rebase, with working resolver access.
- A spec + regression test so this can't silently regress again.

**Non-Goals:**
- No new resolver UI — reuse `ConflictEditor`/`ConflictPanel` as they are.
- Not building a full 3-way merge editor (take-side + hand-edit stays the model).
- Not changing merge/rebase initiation flows.

## Decisions

- **Resolve control files via git, not path assumptions.** Replace the hardcoded `‹repo›/.git/…` checks with `git rev-parse --git-path MERGE_HEAD` / `rebase-merge` / `rebase-apply`, then `fs.access` the returned paths. `--git-path` yields the correct absolute location in worktrees and submodules. `rebaseKind` derives from which of `rebase-merge` / `rebase-apply` exists.
  - *Alternative*: parse `.git` file to find the real gitdir. Rejected — `rev-parse --git-path` is exactly the supported primitive and handles every layout.
  - The conflicted-file list (`git diff --name-only --diff-filter=U`) already runs in `cwd: repoPath`, so it is correct in worktrees and is unchanged.
- **Keep precedence explicit.** `ConflictPanel` stays first in the right-panel conditional, above working-tree / commit-detail / multi-select. The spec encodes this ordering so a later refactor that reorders the branches is caught by review/tests.
- **Lock with a worktree regression test.** Add a backend test that creates a worktree, starts a conflicting rebase in it, and asserts `getStatus().conflict.inRebase === true` with the conflicted file — reproducing the exact failure and preventing recurrence.

## Risks / Trade-offs

- **`rev-parse --git-path` spawns git** (vs a bare `fs.access`) → negligible; `getStatus` already runs several git commands, and detection accuracy matters more than a microsecond.
- **`--git-path` returns a path relative to cwd for the standard case** → resolve it against `repoPath` (or run with `cwd: repoPath` and use the returned path directly) before `fs.access`.
- **Older git** → `rev-parse --git-path` has been supported since git 2.5; well below any version we target.

## Migration Plan

Additive bug-fix. No data migration. Ship the detection fix + spec + test; rollback = revert. Validate by pausing a rebase on a conflict both in a normal repo and in a worktree and confirming the right-panel takeover + resolver appear and continue/abort work.

## Open Questions

- Should the conflict takeover also force-show / re-scope when the conflict arises from an in-app bulk squash/drop (which already returns `conflict: true`)? It does today via the post-op refresh; confirm during apply that the refresh reliably flips the panel.
