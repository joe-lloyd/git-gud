## 1. Validate specs against code

- [ ] 1.1 `workspace-layout`: confirm right-panel + sidebar drag-resize, persisted widths, and resizable/scrollable sidebar sections match `src/renderer/App.tsx` and `components/Sidebar/Sidebar.tsx`; note any mismatch.
- [ ] 1.2 `appearance-settings`: confirm the Settings dialog, text-scale (webFrame zoom), high-contrast, accent, and persistence match `components/Settings/Settings.tsx`, `preload/index.ts` (uiApi), and `styles/global.css`.
- [ ] 1.3 `commit-graph`: confirm virtualization, rAF scroll-sync, connector culling, ring nodes, per-row band + end-cap, ref-pill `+N` collapse, selection modifiers, and sidebar-only auto-scroll match `components/Graph/GraphView.tsx` (+ CSS).
- [ ] 1.4 `commit-multiselect`: confirm multi-select detail, bulk squash/drop/cherry-pick/revert, contiguity gating, and conflict reporting match `App.tsx`, `components/MultiSelectDetail/`, and `src/main/git-service.ts`.
- [ ] 1.5 `worktree-management`: confirm list/switch/add (branch creation + default sibling path) and remove (in-app force confirm, no silent no-op) match `components/Worktrees/Worktrees.tsx`, `App.tsx`, and `git-service.ts`.

## 2. Reconcile and finalize

- [ ] 2.1 Resolve naming overlap with in-flight changes (esp. `commit-graph` vs `gitkraken-clone-audit-and-complete`); record the decision in design.md Open Questions.
- [ ] 2.2 `openspec validate establish-baseline-spec` passes with no errors.
- [ ] 2.3 Fix any requirement found to diverge from code in section 1 (edit the spec to match real behavior, or open a bug item if the code is wrong).

## 3. Hand off to the bug/test change

- [ ] 3.1 Enumerate the bugs captured this session (worktree add/remove silent no-op, native `window.confirm` unreliability, graph connector culling, scroll lag, stale `git-service` unit tests using the old `commit(string)` API) as input for the follow-up proposal.
- [ ] 3.2 Propose the follow-up change (`/opsx:propose`) for a regression test suite that asserts these baseline requirements, prioritizing the captured bugs.
