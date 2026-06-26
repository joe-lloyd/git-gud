# git-activity-log Specification

## Purpose
TBD - created by archiving change add-console-dock. Update Purpose after archive.
## Requirements
### Requirement: Capture every git invocation

The system SHALL record every git command the application runs against the active repository — the command and its arguments, the produced stdout and stderr, the exit code, and the duration — and stream each record to the renderer as it completes (or progresses). Both the `simple-git` operations and the streaming commit path SHALL feed this log.

#### Scenario: A command is logged

- **WHEN** the app runs any git operation (e.g. status, log, checkout)
- **THEN** an entry appears in the git activity log showing the command line and its output/exit code

#### Scenario: Branch switch is visible

- **WHEN** the user checks out or switches a branch
- **THEN** the underlying git command and its response appear in the log

#### Scenario: Hook output is captured

- **WHEN** a commit runs hooks that print output
- **THEN** that output appears in the git activity log

#### Scenario: Commit output shows in the console, not the center pane

- **WHEN** the user commits with hooks enabled
- **THEN** the console dock opens (if hidden) and the commit + hook output appears in the git activity log, rather than taking over the center pane

### Requirement: Read-only live log display

The right console SHALL render the activity as a read-only, scrollable, monospace log that auto-scrolls to the newest entry while the user is at the bottom, and distinguishes failed commands (non-zero exit) from successful ones.

#### Scenario: Auto-scroll on new entries

- **WHEN** new git activity arrives and the user is scrolled to the bottom
- **THEN** the log scrolls to show the latest entry; if the user has scrolled up, it does not yank them down

#### Scenario: Failure is distinguishable

- **WHEN** a git command exits non-zero
- **THEN** its log entry is visually marked as failed and shows the exit code

### Requirement: Copy and clear

The user SHALL be able to copy the full git activity log to the clipboard and clear it.

#### Scenario: Copy the log

- **WHEN** the user activates copy
- **THEN** the full log text is written to the clipboard

#### Scenario: Clear the log

- **WHEN** the user activates clear
- **THEN** the displayed log is emptied (new activity continues to append)

### Requirement: Re-scope on repo/worktree change

The git activity log SHALL be scoped to the active repository/worktree and reset when the user switches tabs or worktrees.

#### Scenario: Switching repo resets the log

- **WHEN** the user switches to a different repo tab or worktree
- **THEN** the log reflects the newly-active repository (prior repo's entries are not intermixed)

