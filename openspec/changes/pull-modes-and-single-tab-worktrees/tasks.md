# Tasks: pull-modes-and-single-tab-worktrees

## 1. Pull modes

- [x] 1.1 `GitService.pull`: add `ffOnly` → `--ff-only`; `classifyPullError` gains `not-ff`; preload `pull` opts + `PullErrorKind` extended
- [x] 1.2 Toolbar: caret next to Pull (same pattern as Push) + right-click; App menu items: Pull / Pull (fast-forward only) / Pull (rebase); ff-refusal toast, no recovery modal on ff-only
- [x] 1.3 Tests: classifyPullError not-ff; pull ffOnly integration (diverged bare-remote fixture)

## 2. Single-tab worktrees

- [x] 2.1 Preload/main: `app:save-tabs` IPC persisting `{tabs: [{main, worktree}], active}`; `getSavedTabs` maps the old string-list shape; remove main-side `saveTabState()` bookkeeping from open/activate/add/close handlers
- [x] 2.2 `useGitRepo`: tabs become `{main, worktree}[]`; `repoPath` stays the active worktree path; `mainPath` derived; `loadRepo` resolves main via `getWorktrees()` and merges into an existing tab for the same repo; `switchWorktree(path)` activates in-tab; `switchTab`/`closeTab`/restore updated; persistence on every tab-state change; stale saved worktree falls back to main
- [x] 2.3 TabBar wired to main paths (labels/close unchanged); Sidebar worktree click + Worktrees dialog switch use `switchWorktree` (no new tab)
- [x] 2.4 Toolbar worktree chip when active worktree ≠ main (name + icon, click opens worktrees dialog)
- [x] 2.5 Tests: useGitRepo tab merge/switch behavior; saved-tabs migration (old string list → pairs)

## 3. Verification

- [x] 3.1 Typecheck + full suite
- [ ] 3.2 Manual/e2e sanity: switch worktree in dev app — same tab, chip appears, restart restores worktree
