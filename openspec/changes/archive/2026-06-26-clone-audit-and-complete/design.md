## Context

`git-gud` is an Electron app (electron-vite + React 18 + TypeScript). Current architecture:

- **Main**: `src/main/git-service.ts` wraps `simple-git`; `index.ts` exposes IPC handlers; `github-service.ts` for the GitHub remote-creation panel.
- **Preload**: `src/preload/index.ts` types and exposes the `window.gitApi.*` surface.
- **Renderer**: `App.tsx` orchestrates layout. `useGitRepo` is the single source of repo state. The graph is a hybrid Canvas-lines + DOM-rows virtualized list (`GraphView.tsx`). Side panels: Sidebar, WorkingTree, CommitDetail, DiffViewer. A `ContextMenu` primitive already exists and is in use for commit-node menus.

Existing assets we can build on:
- Virtualized + canvas-overlaid graph with DPR-aware drawing, ref pills, ref grouping, worktree badges.
- `useCommitActions` hook centralizing cherry-pick / merge / rebase / reset / tag actions with toast feedback.
- Auto-stash + restore pattern already implemented in `mergeCurrentInto`.

Gaps vs. proposal:
- No drag-and-drop on branch refs in the graph.
- Sidebar lacks collapsible accordion behavior and per-section context menus; no double-click checkout.
- Right-click context menus exist only on commit nodes (graph). Branch and stash menus are missing.
- `commitRevert`, `branchRename` are not in the IPC surface.
- No documented perf budget; large repos haven't been stress-tested.

**Constraints**: must stay on `simple-git` (no `nodegit` native rebuilds); TypeScript strict; pnpm with `--ignore-scripts` and `minimumReleaseAge: 4320`; minimize new dependencies; dark-themed UI consistent with current CSS variables.

## Goals / Non-Goals

**Goals:**
- Boot to zero console errors against any valid local repo.
- UI state reflects `.git` after every mutating operation, on window focus, and on FS events for repos with active workflows.
- Fluid graph at 10k commits: < 250 ms initial paint after data load, sustained 60 fps scrolling on a 2019-class MacBook Pro.
- Drag-and-drop on branch pointers triggers Merge / Rebase / Checkout via the existing `ContextMenu` primitive.
- Complete context-menu coverage on commits, branches (sidebar + graph pills), and stashes.
- Sidebar shows Local / Remote(grouped) / Stashes / Tags as collapsible accordion sections; double-click branch checks out.
- Right panel: Working-Tree mode has explicit Unstaged / Staged split + inline-or-side-by-side diff + commit form; Commit mode shows metadata + file list + diff (existing `CommitDetail` extended).

**Non-Goals:**
- Cross-platform parity beyond the current Electron support matrix.
- Interactive rebase UI changes (already covered by `InteractiveRebase` component).
- GitLab / Bitbucket integration. GitHub support remains as-is.
- Implementing `git lfs`, submodule operations, or signed-commit verification — out of scope.
- Replacing `simple-git` with `dugite`/`nodegit`. (Proposal lists them as acceptable alternatives but the current binding works.)

## Decisions

### 1. Stay on `simple-git`; centralize error surfacing

We will not migrate to `dugite` or `nodegit`. `simple-git` is already integrated and handles every operation in scope. Cost of swapping (native builds, packaging changes, retesting every flow) is not justified by the proposal.

To address the audit gap, every IPC handler in `src/main/index.ts` must:
1. Catch and return `{ ok: false, error: string }` instead of throwing across the IPC boundary.
2. Renderer dispatches `toast.error(...)` from the existing toast system.
3. Add a `errorBoundary` at `App.tsx` root to catch render-time exceptions and show a recovery state.

**Alternative considered**: throwing across IPC and relying on `window.onerror`. Rejected because Electron serializes Errors with loss; structured results are clearer and align with the existing `{ success, error }` pattern in `git-service.ts`.

### 2. Drag-and-drop via native HTML5 DnD on ref pills

Branch pills (`RefPill` in `GraphView.tsx`) become `draggable`. Drop targets are: other ref pills, branch rows in the sidebar.

On drop, fire `openCtx(e, [Merge, Rebase, Checkout])` (existing context menu) anchored at the cursor. Each option invokes the corresponding `useCommitActions` method, parameterized by `{ source, target }`.

The single backend entry point is a typed `runDragAction(source: string, target: string, action: 'merge' | 'rebase' | 'checkout')` IPC, which:
- For `merge`: checkout target, merge source, restore (autostash pattern from `mergeCurrentInto`).
- For `rebase`: checkout source, rebase onto target with `--autostash`.
- For `checkout`: just `git checkout <target>`.

**Alternative considered**: `react-dnd`. Rejected — added dep + provider boilerplate; native DnD covers our needs (no nested drag layers).

### 3. Sidebar: native `<details>` + custom indicator

Use HTML `<details>`/`<summary>` for accordion sections — zero JS state, free animation handle, keyboard accessibility. Style with custom `summary::-webkit-details-marker { display: none }` and a CSS-driven chevron.

Sections in fixed order: **Local Branches**, **Remote Branches** (grouped by remote, e.g. `origin/`), **Stashes**, **Tags**.

Selection: single click highlights (sets `selectedRef` local state). Double-click on a *branch* fires `methods.handleCheckout`. Double-click on a tag opens a "Checkout (detached)" confirm.

**Alternative considered**: stateful controlled accordion. Adds rerenders for no UX gain.

### 4. Context-menu coverage via a single `ContextMenu` primitive

Reuse the existing `ContextMenu` + `useContextMenu` hook. Add **three** new menu factories alongside the existing `handleCommitContextMenu`:

- `handleBranchContextMenu(ref, kind: 'local' | 'remote')` — checkout, rename, delete, push, pull, copy-name.
- `handleStashContextMenu(stashIndex)` — apply, pop, drop.
- The graph-pill menu reuses `handleBranchContextMenu` so right-click on a `RefPill` in the graph and right-click on a sidebar row produce identical menus.

Menus are theme-styled by existing `ContextMenu.css` — no styling work needed.

### 5. Graph perf: clip layout work, never re-layout on scroll

`buildGraphLayout(commits)` is the only expensive computation; it's already memoized to `commits` identity. Audit step: confirm `useGitRepo` does NOT recreate the `commits` array reference on unrelated re-renders. (Currently fine, but defensive — wrap setter in `setCommits(prev => deepEq(prev, next) ? prev : next)` if pointer-equality flickers.)

For >5000 commits, move `buildGraphLayout` to a Vite-loaded Web Worker (`graphLayout.worker.ts?worker`). No new dependency. Threshold is configurable, default 5000; below the threshold we run synchronously to avoid worker overhead.

Canvas draw already clips to `[startRow, endRow]` with `OVERSCAN=8`. Verify no full-history sweeps remain.

**Alternative considered**: SVG. Rejected — text-DOM + canvas-line hybrid is already faster than SVG for this use case at our scale.

### 6. Working-tree panel: keep `WorkingTree` component, formalize the contract

The current `WorkingTree.tsx` already calls `getStatus()` and renders staged/unstaged. We tighten it:
- Two clearly-labeled lists, "Unstaged" (top) and "Staged" (bottom), each with `+/-` line counts already returned by `getStatus`.
- Buttons per row: Stage / Unstage / Discard, plus group-level "Stage all" / "Unstage all".
- The commit form is part of the same panel (textarea for subject, optional body, "Commit changes" button). Disabled when staged list is empty.
- Clicking a file row toggles `DiffViewer` in the main area (existing).

### 7. Filesystem watcher for live refresh

`chokidar` is already pulled in by `simple-git`'s deps but we won't ship it directly. Instead use Node `fs.watch` in main on the repo's `.git/refs`, `.git/HEAD`, and `.git/index`, debounced 200ms, sending `repo-changed` IPC. Renderer's `useGitRepo` listens and calls `refresh()`.

**Alternative considered**: poll every N seconds. Wastes CPU; misses fast successive changes; user-perceptible lag.

## Risks / Trade-offs

- **Drag-and-drop on branch pills feels easy but can clobber repo state.** → Mitigation: every action goes through the autostash-and-restore pattern; merge conflicts surface as a toast with "Resolve in working tree" CTA rather than a crash. Add a dirty-tree confirm before checkout actions on dirty repos.
- **Web Worker for graph layout introduces a structured-clone hop at the boundary.** → Mitigation: only enable above the 5000-commit threshold; benchmark before merging. Below threshold, sync path keeps the simpler debugging story.
- **`fs.watch` on macOS is unreliable for renames and across symlinks.** → Mitigation: keep window-focus refresh as the backstop; degrade gracefully if the watcher errors.
- **Context-menu coverage means more IPC surface (`branchRename`, `branchDelete`, `commitRevert`).** → Mitigation: all are thin wrappers around `simple-git` raw commands; type them once in preload and consume in `useCommitActions`.
- **Zero-console-errors is a moving target** — third-party warnings (React strict mode, deprecation notices from Electron) can drift in. → Mitigation: define "zero errors" as zero `console.error` calls from our code paths during a smoke-test of: open repo → scroll graph → stage+commit → checkout → merge via DnD → close. Codify in a Vitest e2e where feasible.

## Migration Plan

No runtime migration; this is a single-app desktop binary. Rollout = ship a new build.

Order of work (matches `tasks.md`):
1. Audit + fixes first — no new features behind broken foundations.
2. Capability slices in parallel after audit: graph perf, sidebar, context menus, working-tree panel.
3. Drag-and-drop last, since it depends on (a) the new branch IPC endpoints and (b) the unified context-menu factories.

Rollback: revert the merge commit. No state migration to undo.

## Open Questions

- Should the diff viewer default to **side-by-side** or **inline**? Proposal says "side-by-side or inline" — pick a default and add a toggle. Recommend side-by-side default to match the app's visual identity.
- Tag double-click: detached-HEAD checkout, or open "Create branch from tag"? Recommend the latter; safer.
- Drag-and-drop on the sidebar: should dragging a branch onto another sidebar branch also trigger the menu? Recommend yes (consistency), confirm in implementation.
