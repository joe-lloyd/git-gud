## Why

`git-gud` aims to be a GitKraken-style desktop Git client but the codebase is partially broken and the GitKraken UX parity is incomplete (drag-and-drop merge/rebase, full context menus on every surface, fluid graph rendering at scale, and an authoritative diff/staging panel). Before adding more features, the app must launch error-free, accurately mirror `.git` state, and render large histories without jank. Then it must close the GitKraken UX gap so the product is recognizable to users coming from GitKraken.

## What Changes

- Run a codebase audit pass: fix runtime exceptions, broken imports, console errors, and any state desync between the UI and `.git` (`useGitRepo` cache invalidation on focus/refresh/file-watch).
- Optimize commit-graph rendering for large repos: viewport-clipped canvas draws, memoized layout, off-main-thread parsing for very large histories where appropriate.
- Promote `simple-git` usage to a single, well-typed adapter; tighten error handling so merge conflicts, detached HEAD, and missing upstream all surface as toast errors rather than crashes.
- **GitKraken UX parity**:
  - Multi-colored, per-branch-consistent commit graph; hover highlights the branch label; click populates the right panel.
  - Drag a branch pointer onto another branch and choose **Merge / Rebase / Checkout** from a contextual drop menu.
  - Left sidebar: collapsible accordion sections for Local Branches, Remote Branches (grouped by remote), Stashes, Tags. Single-click selects; double-click on branch checks out.
  - Right-click menus on commit nodes (create branch, cherry-pick, reset soft/mixed/hard, revert), on branches (checkout, rename, delete, push, pull), and on stashes (apply, pop, drop).
  - Right panel: Working-Directory mode shows split Unstaged / Staged with side-by-side or inline diff and a commit form ("Commit changes" button); Commit mode shows commit metadata + file list + diff.
- Definition-of-done gates: zero console errors on launch; graph renders correctly for ≥10k commits at 60fps scroll; all listed context menus operate without breaking local repo state.

## Capabilities

### New Capabilities

- `app-stability`: Audit + runtime-correctness contract — no uncaught exceptions, IPC errors surfaced as toasts, UI always reflects current `.git` state after operations and on window focus.
- `commit-graph`: Visual contract for the multi-colored, branch-consistent commit graph including hover, selection, virtualization, and drag-and-drop interactions on branch labels.
- `repo-navigation`: Left sidebar accordion sections (Local Branches, Remote Branches, Stashes, Tags), selection vs. checkout semantics, and current-branch indicator.
- `context-menus`: Theme-styled, context-aware right-click menus on commit nodes, branches (sidebar + graph), and stashes, with the action sets specified for each surface.
- `working-tree-panel`: Right-side staging / commit panel — Unstaged vs Staged split, side-by-side or inline file diff, commit message form with "Commit changes" action.
- `graph-performance`: Performance contract for graph load and scroll — initial paint, frame budget while scrolling, and memory ceiling at large commit counts.

### Modified Capabilities

<!-- No existing specs in openspec/specs/; nothing to delta. All capabilities above are net new. -->

## Impact

- **Affected code**: `src/main/git-service.ts` (error surfaces, drag-drop action endpoints, branch rename/delete/revert), `src/renderer/hooks/useGitRepo.ts` (state freshness), `src/renderer/components/Graph/*` (drag-drop, hover highlight, perf), `src/renderer/components/Sidebar/*` (accordions, dbl-click checkout, branch & stash context menus), `src/renderer/components/ContextMenu/*` (new menu variants), `src/renderer/components/WorkingTree/*` and `DiffViewer/*` (staged/unstaged split + commit form), `src/preload/index.ts` (any new IPC channels).
- **APIs**: Preload IPC surface extended with `branchRename`, `branchDelete`, `commitRevert`, and a single `runDragAction(sourceRef, targetRef, action)` entry point. No external HTTP APIs.
- **Dependencies**: No new runtime dependencies expected; reuse `simple-git`. If perf demands it, evaluate moving graph-layout into a Web Worker (no new package — uses Vite's `?worker` import).
- **Risk**: Drag-and-drop git actions touch the local repo state; must include autostash + restore-on-failure (already present in `mergeCurrentInto`) for new flows.
