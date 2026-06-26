## 1. Validate specs against code

- [x] 1.1 `workspace-layout`: confirmed against `src/renderer/App.tsx` + `components/Sidebar/Sidebar.tsx` — right-panel + sidebar drag-resize, persisted widths, resizable/scrollable sections all match.
- [x] 1.2 `appearance-settings`: confirmed against `components/Settings/Settings.tsx`, `preload/index.ts` (uiApi), `styles/global.css` — settings dialog, webFrame text-scale, high-contrast, accent, persistence all match.
- [x] 1.3 `commit-graph`: confirmed against `components/Graph/GraphView.tsx` (+CSS) — virtualization, rAF scroll-sync, connector culling, ring nodes, per-row band + end-cap, ref-pill `+N`, selection modifiers, sidebar-only auto-scroll all match.
- [x] 1.4 `commit-multiselect`: confirmed against `App.tsx`, `components/MultiSelectDetail/`, `git-service.ts` — multi-select detail, bulk squash/drop/cherry-pick/revert, contiguity gating, conflict reporting all match.
- [x] 1.5 `worktree-management`: confirmed against `components/Worktrees/Worktrees.tsx`, `App.tsx`, `git-service.ts` — list/switch/add (branch creation + default sibling path) and remove (in-app force confirm, no silent no-op) all match.

## 2. Reconcile and finalize

- [x] 2.1 Naming decision: keep baseline `commit-graph` as the concrete render/interaction spec; the graph *performance* capabilities in `gitkraken-clone-audit-and-complete` stay separate and unarchived — reconcile only if/when that change archives.
- [x] 2.2 `openspec validate establish-baseline-spec` passes with no errors.
- [x] 2.3 No divergences found in section 1 — specs were authored directly from current code (including this session's fixes), so none needed correcting.

## 3. Hand off to the bug/test change

- [x] 3.1 Captured-bug list enumerated (worktree add/remove silent no-ops, native `window.confirm` unreliability, graph connector culling, scroll lag, stale `git-service` unit tests) — used as input for the follow-up.
- [x] 3.2 Follow-up `bug-catalog-and-regression-suite` proposed and implemented (suite green).
