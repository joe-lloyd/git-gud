## Why

This session shipped a lot of behavior and surfaced a cluster of bugs — several of them *silent* failures (operations that looked like they worked but did nothing). Most were fixed inline, but there is no test coverage locking those fixes in, the existing `git-service` unit tests are stale and failing (2/22), and a known-unreliable pattern (native `window.confirm`) still lingers in a couple of destructive paths. Without a regression suite, the next round of edits can quietly reintroduce exactly these failures. This change catalogs every captured bug, closes the remaining ones, and builds an automated suite that asserts the `establish-baseline-spec` requirements.

## What Changes

Bug catalog (captured this session):

| # | Bug | Area | Status |
|---|-----|------|--------|
| 1 | Add Worktree silently no-op'd — only worked for existing branches and the result was ignored, so the form cleared as if it succeeded | worktree-management | Fixed inline (creates branch via `-b`, surfaces git errors) — needs a test |
| 2 | Remove Worktree silently no-op'd — result ignored and dirty/locked trees need `--force` | worktree-management | Fixed inline (in-app force confirm) — needs a test |
| 3 | Native `window.confirm` is unreliable in this Electron build (returns false / no-ops) → silent no-ops; still used by bulk **Drop** and WorkingTree **discard** | reliable-dialogs | **Open** — convert remaining call sites |
| 4 | Graph connector lines vanished once a node scrolled off-screen (virtualized culling dropped edges) | commit-graph | Fixed inline (segment-vs-viewport culling) — needs a test |
| 5 | Graph canvas lagged behind native scroll (repaint waited on React state) | commit-graph | Fixed inline (rAF scroll-sync) — needs a test |
| 6 | `test/backend/git-service.test.ts` calls `commit('string')` against the `CommitOpts` API → empty message → 2 failing tests | testing | **Open** — update to the object API |

- **Fix the open items**: update the stale `git-service` tests to the current `commit(CommitOpts)` API; replace the remaining native `window.confirm` destructive prompts (bulk Drop, WorkingTree discard) with the in-app `ConfirmModal` flow already used for worktree removal.
- **Add a regression suite** (vitest, already configured) that asserts the `establish-baseline-spec` behaviors and pins each fixed bug above so it can't silently return.
- Get the whole suite **green** and document how to run it.

## Capabilities

### New Capabilities
- `regression-tests`: an automated test suite that covers the baseline behaviors most prone to silent regression (git-service operations and pure renderer logic) and pins each captured bug; runs via `pnpm test` and is green.
- `reliable-dialogs`: destructive confirmations and prompts SHALL use in-app modals (never native `window.confirm`/`alert`) and SHALL always report an outcome, so an operation can never silently no-op.

### Modified Capabilities
<!-- None — openspec/specs/ is still empty (establish-baseline-spec not yet archived). The bug fixes align code to that pending baseline; capabilities there are referenced, not modified here. -->

## Impact

- **Tests** (`test/backend`, `test/frontend`, `src/renderer/test`): new specs for git-service bulk/worktree ops, ANSI stripping + exit-code capture in `commitStreaming`, `rangeStat` parsing, ref grouping/collapse, and selection-range / worktree-path derivation; fix the 2 stale `git-service` tests. No new dependencies (vitest + jsdom already present).
- **Renderer** (`src/renderer/App.tsx` bulk Drop, `components/WorkingTree/WorkingTree.tsx` discard): replace native `window.confirm` with the existing `ConfirmModal` pattern.
- **Depends on** `establish-baseline-spec` for the behavior definitions the suite asserts (archive that first, or treat its specs as the reference).
- No production dependency or architectural changes.
