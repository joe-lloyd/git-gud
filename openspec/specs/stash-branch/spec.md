# stash-branch Specification

## Purpose
TBD - created by archiving change git-feature-coverage. Update Purpose after archive.
## Requirements
### Requirement: "Create branch from stash" context-menu action
The stash context menu in the Sidebar SHALL include an action "Create branch from stash…" that opens the InputModal asking for a branch name. The modal subtitle SHALL inform the user that this action applies the stash and removes it from the list (matching `git stash branch` semantics).

#### Scenario: Action opens InputModal with subtitle
- **WHEN** the user right-clicks a stash entry
- **AND** picks "Create branch from stash…"
- **THEN** the InputModal opens with title "Create Branch from stash@{N}"
- **AND** the subtitle reads "Applies the stash and removes it from the list"

#### Scenario: Successful branch creation
- **WHEN** the user enters a valid branch name and confirms
- **THEN** the renderer calls a `stash:branch` IPC running `git stash branch <name> stash@{N}`
- **AND** on success: the new branch becomes current, the stash is removed, a success toast appears
- **AND** the working tree reflects the stash's changes

#### Scenario: Name collision shows error toast
- **WHEN** the branch name already exists locally
- **THEN** the IPC returns failure
- **AND** an error toast surfaces the underlying git error message
- **AND** the stash is NOT removed (git's atomicity guarantees this)

### Requirement: Action respects stash modification state
The action SHALL be disabled (greyed out, no-op) when there are uncommitted changes in the working tree that conflict with the stash, to mirror git's own refusal.

#### Scenario: Dirty conflicting tree disables the action
- **WHEN** the working tree has modifications that would conflict with the stash
- **AND** the user opens the stash context menu
- **THEN** "Create branch from stash…" is rendered disabled with a tooltip explaining why

