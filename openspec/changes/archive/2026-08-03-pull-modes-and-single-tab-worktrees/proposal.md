# Proposal: pull-modes-and-single-tab-worktrees

## Why

Pull always runs git's configured default; users who want `--ff-only` safety or a rebase pull have no way to say so from the toolbar. Worktrees are a feature *of one repository*, but the app opens each worktree as a separate tab with its own identity — switching between worktrees of the same project feels like switching projects, and the tab bar fills with duplicates of one repo.

## What Changes

- **Pull modes**: the toolbar Pull button gains a caret/right-click menu (same pattern as Push): Pull (default), Pull fast-forward only (`--ff-only`), Pull with rebase (`--rebase`). A refused fast-forward gets a targeted message instead of a raw git error.
- **Single-tab worktrees**: one tab per repository (identified by its main worktree). Selecting a worktree — sidebar row or manage dialog — switches the active working directory *within* that tab instead of opening a new tab. The toolbar shows a worktree chip whenever a non-main worktree is active. Tab session persistence stores the repo plus its active worktree.

## Capabilities

### New Capabilities

- `pull-modes`: pull strategy selection from the toolbar (default / ff-only / rebase) with classified ff-refusal feedback.

### Modified Capabilities

- `worktree-management`: switching a worktree keeps the current tab (requirement change: "opens that worktree as the active repository" becomes "activates it inside the same repository tab"); an active-worktree indicator is required.

## Impact

- **Main**: `GitService.pull` gains `ffOnly`; tab-state persistence becomes renderer-driven (`{main, worktree}` pairs, backward-compatible read of the old string list); no watcher changes (activation already re-points them).
- **Renderer**: `useGitRepo` tracks tab identity (main path) separately from the active worktree path; Toolbar pull caret + worktree chip; Sidebar/Worktrees switch handlers.
- **Preload**: pull options type, tab-state save/load shapes.
- **Grade**: production, same bar as existing flows.
