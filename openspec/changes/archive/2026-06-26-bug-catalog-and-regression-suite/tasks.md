## 1. Close open bugs

- [x] 1.1 Fix `test/backend/git-service.test.ts`: replace `commit('…')` calls with `commit({ subject: '…' })` and assert the resulting message; confirm the previously-failing merge/commit cases pass.
- [x] 1.2 Replace native `window.confirm` for **bulk Drop** in `src/renderer/App.tsx` with the in-app `ConfirmModal` (danger), mirroring the worktree-removal flow.
- [x] 1.3 Replace native `window.confirm` for **discard changes** in `components/WorkingTree/WorkingTree.tsx` with an in-app `ConfirmModal`.

## 2. Make helpers testable

- [x] 2.1 Export `groupRefs` (and the representative-pill/overflow selection used by `RefPillCluster`) from `components/Graph/GraphView.tsx` so it can be unit-tested. (Moved to `lib/refs.ts`.)
- [x] 2.2 Extract the shift-select contiguous-range computation and the default worktree path derivation into pure, importable functions. (`lib/selection.ts`, `lib/worktree-path.ts`.)

## 3. git-service integration tests

- [x] 3.1 Test `addWorktree`: new branch is created + listed; failure returns `{success:false}` with an error (not a thrown silent success). (Caught a real latent bug: the `show-ref --quiet` existence check was unreliable through simple-git → new-branch worktrees failed; fixed to use `branch --list`.)
- [x] 3.2 Test `removeWorktree`: dirty worktree fails without force, succeeds with `force: true`.
- [x] 3.3 Test `cherryPickMany` / `revertMany` and `squashCommits` / `dropCommits` on a contiguous range (combined/removed correctly); reject non-contiguous selections via `resolveLinearRange`.
- [x] 3.4 Test `commitStreaming`: ANSI escapes stripped from captured output; exit code + success reported for a clean commit and a hook-aborted (non-zero) commit.
- [x] 3.5 Test `rangeStat` parses files/insertions/deletions from `git diff --shortstat`.

## 4. Pure renderer unit tests

- [x] 4.1 Test `groupRefs` collapse: HEAD + local + remote + tag → expected representative pill + `+N` count.
- [x] 4.2 Test contiguous-range selection logic (anchor → target inclusive, by row order).
- [x] 4.3 Test worktree path derivation: `/a/b/proj` + `feature/x` → `/a/b/proj.worktrees/feature/x`.

## 5. Green + reliability assertions

- [x] 5.1 Guard test (`test/frontend/no-native-confirm.test.ts`) fails if any renderer code uses native `window.confirm`/`alert`. Converted the remaining sites (ConflictPanel abort, ConflictEditor save-with-markers) to `ConfirmModal`.
- [x] 5.2 `pnpm test --run` is green (57 passed / 8 files); `pnpm typecheck` and `pnpm build` pass.
- [x] 5.3 Documented the suite in README (Testing section) with a CI follow-up note.
