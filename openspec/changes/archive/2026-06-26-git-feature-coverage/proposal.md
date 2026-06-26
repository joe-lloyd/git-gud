## Why

The app already covers the day-to-day Git surface (commit, push/pull/fetch, branch ops, stash, tags, worktrees, bisect, patch, rebase, cherry-pick, merge, checkout, reset, hunk-level stage/discard) but has growing blind spots that bite power users at exactly the moments they're under pressure: there's no `reflog` recovery when a reset goes wrong, no `--amend` so every typo becomes a new commit, no content-history search (`log -S`) to find when a snippet appeared, no word-level diff for prose/config changes, no `git clean` for the inevitable `node_modules` cleanup, no `stash branch` for the "I should turn this WIP into a real branch" flow, and no `rerere` for repos with recurring conflicts. We want to close these gaps deliberately — inventory what we support, what we don't, and ship the missing pieces in priority order so the app is genuinely "100% Git" in everyday use.

## What Changes

- Create a docs/git-features.md catalog enumerating every Git feature the app exposes, with status: **supported / partial / planned / not planned**, grouped by category (history, staging, branching, remote, recovery, advanced).
- Add eight new user-facing capabilities (see below). Each follows the existing destructive-op pattern: in-place actions use a two-step "armed → confirm" toggle, repo-level ops use the existing `ConfirmModal`. All new UI is keyboard-accessible.
- Polish the existing per-hunk staging into a named **interactive-add** flow (current implementation is the engine; this is the UX wrapper — keyboard shortcuts, "stage all in hunk", multi-select).
- Reflog and rerere live behind a clear opt-in: reflog gets its own panel (right-column, same pattern as Bisect); rerere is a settings toggle that surfaces when relevant.

This is non-breaking — all existing features keep working unchanged. New features add to the surface area only.

## Capabilities

### New Capabilities
- `commit-amend`: amend the last commit's message and/or staged changes via the WorkingTree commit box.
- `word-diff`: render word/character-level changes inside DiffViewer as an opt-in toggle.
- `pickaxe-search`: content-history search (`git log -S`) integrated into the existing search bar.
- `stash-branch`: create a new branch from a stash entry via the stash context menu.
- `clean-untracked`: review and delete untracked + ignored files (`git clean -fdx`) via a confirm modal.
- `reflog-recovery`: browse reflog entries and restore HEAD to a previous position; surfaces as a right-column panel.
- `rerere-recording`: opt-in toggle for `rerere.enabled` plus visibility of recorded resolutions during merge conflicts.
- `interactive-add`: keyboard-driven per-hunk and per-line staging flow built on the existing applyPatch primitive.

### Modified Capabilities
<!-- None — no existing capability specs in openspec/specs/, so no requirement deltas. -->

## Impact

- **Renderer**: new components for ReflogPanel, AmendBox (additive to WorkingTree), word-diff toggle in DiffViewer, pickaxe mode in SearchBar, clean-modal, rerere settings. Right-column slot already accommodates panels (Bisect is the precedent).
- **Main process**: new IPC handlers + GitService methods: `amend`, `logPickaxe`, `getReflog`, `restoreFromReflog`, `clean`, `cleanPreview`, `stashBranch`, `getRerereResolutions`, `setRerereEnabled`. Word-diff is renderer-side parsing of `git diff --word-diff=porcelain` output.
- **Preload**: matching API surface.
- **Documentation**: new `docs/git-features.md` as the authoritative coverage matrix. Updated as features land.
- **Risk**: reflog and clean are destructive — both require explicit confirms. Rerere is a behavioral change to merge resolution; off by default.
