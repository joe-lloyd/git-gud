## Why

`git-gud` has grown a large UI/interaction surface (resizable panels, themed appearance, a canvas commit graph, multi-select commit operations, worktree management) but `openspec/specs/` is empty — there is no canonical, behavior-level source of truth. Recent rapid iteration shipped many of these features and uncovered several regressions (worktree add/remove silently no-op'ing, graph connectors vanishing on scroll, native `window.confirm` being unreliable). Without a written baseline, every change risks silently breaking behavior nobody wrote down. This establishes that baseline so the next change (a bug-fix + regression-test pass) has something concrete to verify against.

## What Changes

- Capture the **current, real behavior** of the application's recently-built interaction surface as canonical capability specs — derived from the code and this session's work, not aspirational.
- Document five capabilities at requirement level: workspace layout/resizing, appearance settings, the commit graph view, multi-select commit operations, and worktree management.
- Each requirement is written as a verifiable behavior (WHEN/THEN scenarios) so it can back a regression test or manual check.
- No code changes — this is documentation only. It records the contract that existing code already satisfies (and, where this session fixed a bug, the corrected behavior).
- Capabilities already owned by in-flight changes (`add-commit-hook-output` → commit output, `add-syntax-highlighting` → diff/conflict highlighting, `git-feature-coverage` → reflog/amend/pickaxe/etc., `clone-audit-and-complete` → graph performance/context menus) are **out of scope here** and referenced rather than re-specified.

## Capabilities

### New Capabilities
- `workspace-layout`: resizable right panel and left sidebar via drag handles, drag-resizable + scrollable sidebar sections (local branches / remote / stashes / worktrees), and persistence of all widths/heights across sessions.
- `appearance-settings`: a settings surface controlling UI text scale (native page zoom), a high-contrast mode, and the neon-pink (Dracula-style) accent; settings persist and re-apply on launch.
- `commit-graph`: the canvas+DOM commit graph — virtualized rows, scroll-synced connector/node rendering, viewport connector culling, ring nodes, per-row lane band, collapsed ref pills with `+N` overflow, and selection behavior (single / shift-range / ⌘-toggle) including when the graph auto-scrolls.
- `commit-multiselect`: selecting multiple commits and acting on them in bulk (squash, drop, cherry-pick, revert), with contiguity rules and a multi-select detail panel.
- `worktree-management`: listing, switching to, adding (with branch creation and a default sibling path), and removing (with a force-confirm fallback) worktrees.

### Modified Capabilities
<!-- None — openspec/specs/ is empty, so there are no existing canonical specs to modify. -->

## Impact

- **Specs only**: adds `openspec/specs/<capability>/spec.md` for the five capabilities above (via this change's delta files, archived on apply).
- **No runtime code touched.** The specs describe behavior already implemented in `src/renderer/App.tsx`, `components/Graph/GraphView.tsx`, `components/Sidebar/Sidebar.tsx`, `components/Settings/Settings.tsx`, `components/MultiSelectDetail/`, `components/Worktrees/Worktrees.tsx`, and `src/main/git-service.ts`.
- **Sets up the follow-up change**: a bug-catalog + regression-test-suite proposal that targets the issues captured this session and verifies them against these requirements.
- **Relationship to existing changes**: this baseline does not block or alter them; overlapping areas (graph performance, commit output) remain owned by their respective changes.
