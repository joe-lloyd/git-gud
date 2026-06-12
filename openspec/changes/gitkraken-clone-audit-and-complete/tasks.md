## 1. Phase 1 — Audit & Stabilization

- [ ] 1.1 Run `pnpm dev` against three test repos (small, medium, large) and capture every renderer + main console `error`/`warn`; create one issue/checklist entry per finding — **USER ACTION REQUIRED** (needs hands-on testing)
- [x] 1.2 Run `pnpm typecheck` and `pnpm test`; fix every TS error and failing test before any feature work — baseline + post-refactor: 9/9 tests pass, typecheck clean
- [x] 1.3 Wrap every IPC handler in `src/main/index.ts` to return `{ ok: true, data } | { ok: false, error: string }` and remove any `throw` across the IPC boundary — standardized to existing `{ success, error? }` shape (typed as `Result` in preload); every bool-returning handler now returns `Result`. New IPCs added: `git:revert`, `git:rename-branch`, `git:delete-remote-branch`, `git:run-drag-action`. Note: design accepted using `success` over `ok` to avoid touching dozens of working call sites.
- [x] 1.4 Update `src/preload/index.ts` types so the renderer gets the result-shape; renderer call sites surface `{ ok: false }` via `toast.error` — `Result` exported, all bool-returning entries retyped, hooks/components updated to read `r.success`/`r.error`
- [x] 1.5 Add a top-level `ErrorBoundary` in `src/renderer/App.tsx` with a "Reload" recovery action — `ErrorBoundary` added to `AppAux/AuxComponents.tsx`, wraps `<App />` in `main.tsx`
- [x] 1.6 Audit `useGitRepo` for stale closures and dropped refresh paths; ensure `refresh()` runs after every mutating op AND on `focus` — focus listener + `git:repo-changed` listener moved inside the hook with a ref for the latest `refresh` to avoid stale closures
- [x] 1.7 Add `chokidar`-free FS watcher in main using `fs.watch` on `.git/refs`, `.git/HEAD`, `.git/index`, debounced 200 ms; emit `repo-changed` IPC event consumed by `useGitRepo` — watcher rewritten in `main/index.ts` (covers HEAD/index/refs/packed-refs/logs, recursive, 200ms debounce), now starts for both `open-dialog` and `open-path` paths, cleaned up on `window-all-closed`
- [ ] 1.8 Verify `app-stability` spec scenarios manually (boot → graph → stage+commit → checkout → external commit → focus) before moving to Phase 2 — **USER ACTION REQUIRED** (needs hands-on app testing)

## 2. Performance pass

- [ ] 2.1 Confirm `commits` reference stability in `useGitRepo`; add a defensive shallow-equality guard on `setCommits` if needed
- [ ] 2.2 Profile `buildGraphLayout` against a 10k-commit fixture; record current ms cost
- [ ] 2.3 Extract a `?worker` variant of `buildGraphLayout` (Vite Web Worker import); add a threshold constant (`GRAPH_WORKER_THRESHOLD = 5000`)
- [ ] 2.4 Switch `GraphView` to call the worker above threshold; show a tiny "Laying out graph…" placeholder if the worker takes > 80 ms
- [ ] 2.5 Audit Canvas draw loop in `GraphView.tsx` — confirm every iteration is within `[startRow, endRow]`; no full-array sweeps on scroll/select
- [ ] 2.6 Re-run the 10k-commit benchmark and record before/after numbers in `design.md` Decisions section

## 3. Commit graph — interaction parity

- [ ] 3.1 Implement consistent multi-color branch palette in `graphLayout.ts` (deterministic per branch label hash, 8+ hues)
- [ ] 3.2 Add hover state on `CommitRow` that highlights matching ref pills (CSS-only via `:hover` propagation + a data-attribute)
- [ ] 3.3 Make `RefPill` `draggable`; emit `{ ref, kind: 'local' | 'remote' | 'tag' }` as `application/x-git-ref` MIME via `dataTransfer.setData`
- [ ] 3.4 Make `RefPill` and sidebar branch rows drop targets; on drop open the context menu with Merge / Rebase / Checkout
- [ ] 3.5 Wire each drag-menu action to a single new IPC `runDragAction(source, target, action)` in main
- [ ] 3.6 Implement `runDragAction` using autostash + restore-on-failure pattern (model after `mergeCurrentInto`)
- [ ] 3.7 Add Esc cancel for active drags and open drop-menus

## 4. Sidebar — accordion + context-aware actions

- [ ] 4.1 Restructure `Sidebar.tsx` to use `<details>`/`<summary>` for sections: Local, Remote, Stashes, Tags
- [ ] 4.2 Group remote branches by first path segment (`origin/`, `upstream/`) as nested `<details>` blocks
- [ ] 4.3 Add a current-branch indicator (checkmark + bold) on the active local branch
- [ ] 4.4 Implement single-click selection (highlights row, no checkout)
- [ ] 4.5 Implement double-click: branch → `handleCheckout`; remote-branch → checkout creating local tracking branch; tag → "Create branch from tag" modal; stash → apply (no drop)
- [ ] 4.6 Style chevrons and empty-section placeholders to match the dark theme

## 5. Context menus — full coverage

- [ ] 5.1 Verify existing commit-node menu still works after IPC refactor; add **Revert commit** entry calling a new `commitRevert(sha)` IPC
- [ ] 5.2 Add `handleBranchContextMenu(ref, kind)` factory in `App.tsx`; mount it on sidebar branch rows AND on graph `RefPill`
- [ ] 5.3 Wire branch menu actions: Checkout, Rename (new `branchRename(old, new)` IPC), Delete (new `branchDelete(name, force?)` IPC with safe→force fallback), Push, Pull, Copy name
- [ ] 5.4 For remote branches: Delete uses `git push origin --delete <branch>` behind an explicit confirm modal
- [ ] 5.5 Add `handleStashContextMenu(index)` for Apply / Pop / Drop, with Drop behind a confirm modal
- [ ] 5.6 Confirm Esc and outside-click dismiss every menu; window blur also closes (already in `useContextMenu`, verify)

## 6. Working-Tree panel + diff viewer

- [ ] 6.1 Refactor `WorkingTree.tsx` into two clearly-labeled lists (Unstaged top, Staged bottom) with `+N / -N` counts already returned by `getStatus`
- [ ] 6.2 Add per-row Stage / Unstage / Discard buttons; add group-level Stage all / Unstage all
- [ ] 6.3 Add Discard confirm modal (uses existing `ConfirmModal` in `AuxComponents`)
- [ ] 6.4 Add the commit form below the lists: subject input, body textarea, "Commit changes" button; disable until subject non-empty AND staged list non-empty
- [ ] 6.5 Extend `DiffViewer.tsx` with a side-by-side / inline toggle; default to side-by-side; persist preference in `useState` at panel scope (session-only)
- [ ] 6.6 Verify untracked-file diff still renders against `/dev/null` (already in `getFileDiff`)

## 7. Definition-of-done verification

- [ ] 7.1 Smoke-test: open a real GitHub repo, run end-to-end flow (open → scroll → stage → commit → branch → merge via DnD → close); zero console errors
- [ ] 7.2 Smoke-test against a 10k-commit fixture repo; confirm 250 ms initial paint and 60 fps scroll (use the Performance tab's FPS meter)
- [ ] 7.3 Exercise every context menu surface (commit, local branch, remote branch, sidebar stash, ref pill) and confirm all actions complete cleanly
- [ ] 7.4 Exercise drag-and-drop merge between two branches against a dirty working tree; confirm autostash + restore works in both success and failure (force a conflict)
- [ ] 7.5 Update README screenshots and short demo gif (optional but recommended)
- [ ] 7.6 Run `openspec archive --change gitkraken-clone-audit-and-complete` after merging
