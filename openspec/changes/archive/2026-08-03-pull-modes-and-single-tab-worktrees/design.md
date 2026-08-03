# Design: pull-modes-and-single-tab-worktrees

## Context

Pull already supports `rebase`/`autoStash` options end-to-end (`GitService.pull` → `git:pull` → `doPull` in App with dirty/diverged recovery prompts); only the UI entry point and `--ff-only` are missing. Worktrees: main keeps one `GitService` per *path* in a `services` map; `git:open-path` + tab persistence treat every path as a tab. The sidebar's worktree click calls `loadRepo(path)` → new tab.

## Goals / Non-Goals

**Goals:** pull strategy menu; worktree switch stays in-tab with visible indicator; session restore lands on the same worktree.
**Non-Goals:** per-branch pull config, multi-window, changing worktree add/remove flows.

## Decisions

### D1: Pull menu mirrors the push caret
Toolbar Pull gets a caret + right-click menu via the existing `openCtx` pattern: Pull (git default), Pull (fast-forward only), Pull (rebase). `GitService.pull` gains `ffOnly` → `--ff-only`. `classifyPullError` gains `not-ff` (`Not possible to fast-forward`) so the toast can say "remote and local have diverged — pull with merge or rebase" instead of raw stderr. ff-only + diverged does NOT open the merge/rebase recovery prompt (the user explicitly asked ff-only).

### D2: Tab identity = main worktree path; services stay per-path
`services` in main remains a per-path cache (activation/watchers unchanged). What changes is bookkeeping: the renderer owns the tab list as `{main, worktree}` pairs — `main` from the `isMain` entry of `getWorktrees()` after opening any path. Switching a worktree = `git:open-path(worktreePath)` (already idempotent: creates/activates service + re-points watchers) + updating the active tab's `worktree` field + refresh. No new git plumbing.

**Alternative rejected**: one GitService per repo that internally chdirs — simple-git instances are bound to a cwd; juggling `-C` everywhere is riskier than the existing per-path cache.

### D3: Renderer-driven tab persistence
`open-tabs.json` payload becomes `{tabs: [{main, worktree}], active: main}` written via a new `app:save-tabs` IPC whenever the renderer's tab state changes; main's per-mutation `saveTabState()` calls are removed (they persisted `services` keys, which now include non-tab worktree paths). `getSavedTabs` keeps reading the old `{tabs: string[]}` shape by mapping each string to `{main: s, worktree: s}` — old sessions restore as before.

### D4: Indicator: toolbar worktree chip + existing sidebar highlight
When `worktree !== main`, the toolbar's branch pill area shows a `worktree <name>` chip (worktree icon); clicking opens the Worktrees dialog. The sidebar's current-worktree highlight (`w.path === repoPath`) keeps working because `repoPath` remains the *active worktree path* — only tab identity moves to `main`.

## Risks / Trade-offs

- [Stale saved worktree (folder deleted)] → restore falls back to the tab's main path; sidebar shows the surviving worktrees.
- [Old open-tabs.json with worktree paths as tabs] → each restores as its own tab (main resolved on open, so duplicates of one repo collapse only when reopened manually); acceptable one-time migration.
- [`getOpenTabs` IPC (services keys) no longer matches tabs] → unused by the renderer's tab UI after this change; left for the console/debug only.

## Migration Plan

Additive + backward-compatible persistence read. Rollback: revert; old string-list files still parse.
