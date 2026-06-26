## ADDED Requirements

### Requirement: List and switch worktrees

The application SHALL list all worktrees (in the sidebar and a manage dialog) showing each worktree's branch, SHA, and whether it is the main and/or currently-open worktree, and SHALL let the user switch the open repository to another worktree.

#### Scenario: Switch worktree

- **WHEN** the user selects a worktree other than the current one
- **THEN** the application opens that worktree as the active repository

### Requirement: Add worktree with branch creation and default path

The application SHALL add a worktree for a given branch. If the branch does not exist it SHALL be created (`-b`); if it exists it SHALL be checked out into the new worktree. The path field SHALL default to a sibling folder `‹project›.worktrees/‹branch›` derived from the branch name, remain user-overridable, and the application SHALL ensure the parent directory exists before adding.

#### Scenario: Default path from branch

- **WHEN** the user types a branch name in the Add Worktree form without editing the path
- **THEN** the path auto-fills to `‹project-parent›/‹project-name›.worktrees/‹branch›`

#### Scenario: New branch is created

- **WHEN** the user adds a worktree for a branch that does not yet exist
- **THEN** the branch is created and checked out into the new worktree, and the worktree list updates

#### Scenario: Add failure is surfaced

- **WHEN** adding a worktree fails (e.g. invalid path or git error)
- **THEN** the git error is shown and the form is not cleared (no silent no-op)

### Requirement: Remove worktree with force fallback

The application SHALL remove a worktree, first attempting a normal removal. When git refuses because the worktree has modifications/untracked files or is locked, the application SHALL present an in-app confirmation (not a native dialog) warning that changes will be lost, and on confirmation SHALL force-remove it. Outcomes SHALL always be reported (success toast or error); removal SHALL never silently no-op.

#### Scenario: Clean worktree removes directly

- **WHEN** the user removes a worktree with no local changes
- **THEN** it is removed and the list updates

#### Scenario: Dirty worktree prompts to force

- **WHEN** a normal remove fails because the worktree is dirty or locked
- **THEN** an in-app confirm appears; confirming force-removes the worktree, and declining leaves it in place

#### Scenario: Main / current worktree protected

- **WHEN** a worktree is the main worktree or the currently-open one
- **THEN** its Remove action is disabled
