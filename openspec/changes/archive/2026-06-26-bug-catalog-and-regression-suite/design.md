## Context

The codebase already has vitest (jsdom, globals, `src/renderer/test/setup.ts`) with three test files: `test/backend/git-service.test.ts` (spins up real temp repos — currently 2 failures from a stale `commit('string')` call), `test/frontend/useGitRepo.test.ts`, and `src/renderer/test/highlight.test.ts`. Most bugs from this session are already fixed in code; what's missing is coverage to keep them fixed, plus two open items (stale tests, lingering native `window.confirm`). The `establish-baseline-spec` change defines the behaviors to assert.

## Goals / Non-Goals

**Goals:**
- One catalog of the session's bugs with status, so nothing is lost.
- Close the open items: fix the stale `git-service` tests; replace remaining native `window.confirm` destructive prompts with the in-app `ConfirmModal`.
- A green, CI-runnable regression suite that pins each fixed bug and asserts baseline behavior.

**Non-Goals:**
- No new product features; no new runtime dependencies.
- Not full end-to-end/Electron UI automation — focus on git-service integration tests (real temp repos) and pure-function unit tests, which give the most regression value per unit of effort.
- Not re-testing capabilities owned by other changes (syntax highlighting already has a test; commit-output behavior is covered only at the git-service capture level).

## Decisions

- **Two test tiers.** (1) git-service integration tests against throwaway temp repos (`mkdtempSync`, configured `user.name/email`) — the existing pattern — for bulk ops, worktree add/remove, `commitStreaming`, `rangeStat`. (2) Pure unit tests for renderer helpers (ref grouping, range computation, path derivation) — fast, no DOM.
  - *Alternative*: drive the full UI with Testing Library. Rejected for now — high cost, brittle; the silent-no-op bugs live in git-service + result handling, which the two tiers cover directly.
- **Extract pure helpers where needed.** Ref grouping (`groupRefs`) and the worktree path derivation are currently inline; export them (or lift to a tiny module) so they're unit-testable without rendering. Selection-range logic can be tested as a pure function.
- **Reuse the existing `ConfirmModal`** for the remaining destructive prompts (bulk Drop in `App.tsx`, discard in `WorkingTree.tsx`), mirroring the worktree-removal fix — one consistent pattern, no native dialogs.
- **Fix, don't delete, the stale tests** — update them to `commit({ subject })` so they assert real behavior.

## Risks / Trade-offs

- **Integration tests touch the real `git` binary / filesystem** → use isolated temp repos and clean up in `afterEach`; keep them hermetic (no network).
- **Refactoring helpers for testability could shift behavior** → keep extractions mechanical (move, export) and rely on the new tests + typecheck to confirm parity.
- **Converting discard/drop to in-app modals changes the interaction** (extra modal state) → mirror the already-shipped worktree pattern to keep it small and consistent.
- **CI not yet defined** → at minimum ensure `pnpm test --run` is green locally; wiring CI is a follow-up note, not a blocker.

## Migration Plan

Additive. Land test files + the two small renderer fixes; run `pnpm test --run` to green. Rollback = revert the change. No data migration.

## Open Questions

- Add a CI workflow (GitHub Actions) to run `pnpm test` on PRs, or leave that to a separate infra change? (Lean: note it; do it separately.)
- Should `useGitRepo.test.ts` be expanded for the refresh-reloads-worktrees behavior, or is git-service coverage enough? (Decide during implementation.)
