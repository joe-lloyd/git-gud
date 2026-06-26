## Context

`openspec/specs/` is empty. Several in-flight changes (`git-feature-coverage`, `gitkraken-clone-audit-and-complete`, `add-commit-hook-output`, `add-syntax-highlighting`) describe intended work but none have been archived to canonical specs, and a burst of recent UI work (resizable panels, theming/settings, graph rendering, multi-select, worktree management) shipped without written requirements. This change writes down the behavior the code already exhibits so future changes have a regression baseline.

This is a documentation change. The "how" here is about scoping and accuracy — choosing which behaviors to canonize and ensuring each is grounded in code, not aspiration.

## Goals / Non-Goals

**Goals:**
- Produce five accurate, testable capability specs for behavior that exists in the current codebase.
- Keep each requirement verifiable (WHEN/THEN), so the follow-up change can derive regression tests or manual checks from it.
- Record bug fixes from this session as the *corrected* baseline (e.g. worktree add/remove report failures; the graph auto-scrolls only on sidebar selection).

**Non-Goals:**
- No runtime code changes.
- Not specifying capabilities owned by other changes (commit/hook output, syntax highlighting, reflog/amend/pickaxe, graph performance internals/context menus) — referenced only.
- Not an exhaustive spec of every git operation; this baseline covers the recently-built interaction surface where regression risk is highest.
- Not the bug catalog or test suite — that is the next change.

## Decisions

- **Document current behavior, not the ideal.** Specs are derived by reading the code (`App.tsx`, `GraphView.tsx`, `Sidebar.tsx`, `Settings.tsx`, `MultiSelectDetail`, `Worktrees.tsx`, `git-service.ts`) and this session's history. Where this session fixed a bug, the spec states the fixed behavior so it becomes the contract.
  - *Alternative considered*: spec the whole app top-to-bottom. Rejected — it would duplicate the in-flight changes and balloon scope; the highest-value baseline is the freshly-built surface.
- **Five capabilities, named to avoid collision** with the as-yet-unarchived capabilities in other changes (e.g. this baseline uses `commit-graph` for the concrete render/interaction behavior; graph *performance* internals stay with `gitkraken-clone-audit-and-complete`). On archive, overlaps will be reconciled deliberately.
- **Requirements phrased as observable behavior**, including the "must NOT" cases the user explicitly asked for (auto-scroll only on sidebar selection; band fill not recolored on hover) so the follow-up tests can assert negatives.
- **Persistence and failure-surfacing are first-class requirements**, since the regressions this session were exactly silent failures and lost state.

## Risks / Trade-offs

- **Spec drift from reality** → each requirement was written against current code; the follow-up test pass will validate them and flag any mismatch.
- **Naming overlap with unarchived changes** (`commit-graph`) → noted explicitly; reconcile at archive time rather than pre-emptively renaming and fragmenting vocabulary now.
- **Partial coverage** (only five capabilities) → acceptable and intentional; the catalog of remaining capabilities lives in the other change proposals.

## Migration Plan

No deployment. On `/opsx:apply` + archive, the five spec files land in `openspec/specs/`. Rollback = discard the change directory. No code or data migration.

## Open Questions

- At archive time, should this baseline's `commit-graph` be merged with `gitkraken-clone-audit-and-complete`'s graph capabilities, or kept as the concrete-behavior layer beneath the performance spec? (Defer to the bug/test change.)
- Should the follow-up be a single "bug catalog + regression suite" change, or split into per-area test changes? (Resolve when proposing it.)
