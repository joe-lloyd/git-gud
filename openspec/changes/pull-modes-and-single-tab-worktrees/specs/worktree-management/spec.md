# worktree-management Specification (delta)

## MODIFIED Requirements

### Requirement: List and switch worktrees

The application SHALL list all worktrees (in the sidebar and a manage dialog) showing each worktree's branch, SHA, and whether it is the main and/or currently-active worktree. Selecting a worktree SHALL activate it **inside the same repository tab**: the tab's identity (its main worktree) is unchanged, the active working directory switches, and all views (graph, status, working tree) refresh to the selected worktree. A repository SHALL occupy at most one tab regardless of which worktree is active.

#### Scenario: Switch worktree stays in the tab
- **WHEN** the user selects a worktree other than the current one
- **THEN** the same tab now shows that worktree's state (branch, status, log)
- **AND** no new tab is created

#### Scenario: Opening a worktree path lands in the repo's tab
- **WHEN** the user opens a linked worktree's folder directly
- **THEN** it opens as (or merges into) the repository's single tab with that worktree active

## ADDED Requirements

### Requirement: Active-worktree indicator
When a non-main worktree is active, the toolbar SHALL show a worktree chip with the worktree's name next to the branch indicator; activating the main worktree SHALL remove the chip. Clicking the chip SHALL open the worktree management dialog. The sidebar SHALL keep highlighting the active worktree row.

#### Scenario: Chip appears on linked worktree
- **WHEN** the user switches to a linked worktree
- **THEN** the toolbar shows a chip with that worktree's folder name

#### Scenario: Chip absent on main
- **WHEN** the main worktree is active
- **THEN** no worktree chip is shown

### Requirement: Session restores the active worktree
Tab persistence SHALL store, per tab, the repository's main path and the active worktree path, and restore both. Files written by older versions (plain path list) SHALL still restore. A saved worktree that no longer exists SHALL fall back to the repository's main worktree.

#### Scenario: Restart lands on the same worktree
- **WHEN** the user quits with a linked worktree active and relaunches
- **THEN** the repo tab opens with that worktree active

#### Scenario: Deleted worktree falls back to main
- **WHEN** the saved worktree path no longer exists on disk
- **THEN** the tab opens on the main worktree instead of failing
