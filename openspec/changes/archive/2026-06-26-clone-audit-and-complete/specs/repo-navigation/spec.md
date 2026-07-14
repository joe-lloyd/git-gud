## ADDED Requirements

### Requirement: Left sidebar shows four collapsible sections in fixed order

The left sidebar SHALL render four sections, in this top-to-bottom order: **Local Branches**, **Remote Branches**, **Stashes**, **Tags**. Each section SHALL be collapsible by clicking its header.

#### Scenario: User collapses a section
- **WHEN** the user clicks the header of any section
- **THEN** that section's body is hidden and the chevron rotates to the collapsed state
- **AND** the other sections remain in their current expanded/collapsed state

#### Scenario: Empty section is still visible
- **WHEN** a section has zero items (e.g. no stashes)
- **THEN** the section header is rendered, with the body either empty or showing an "empty" placeholder

### Requirement: Remote branches are grouped by remote name

Remote branches SHALL be grouped by their first path segment (the remote name, e.g. `origin`, `upstream`). Each remote group SHALL be its own nested collapsible group inside the Remote Branches section.

#### Scenario: Two remotes
- **GIVEN** the repo has remotes `origin` and `upstream`
- **WHEN** the sidebar renders
- **THEN** the Remote Branches section contains two nested groups, `origin` and `upstream`, each with its branches listed underneath

### Requirement: Current branch is visually distinguished

In the Local Branches section, the currently checked-out branch SHALL be displayed with a clear visual indicator (e.g. a leading checkmark/dot and bold text).

#### Scenario: Switching branch updates the indicator
- **WHEN** the current branch changes
- **THEN** the indicator moves to the newly checked-out branch and is removed from the previous one

### Requirement: Click selects; double-click checks out

In the sidebar, single-clicking any item SHALL highlight it as the active selection. Double-clicking a **branch** (local or remote) SHALL trigger a `git checkout` of that branch. Double-clicking a **tag** SHALL prompt the user to create a branch from the tag. Double-clicking a **stash** SHALL apply the stash (without dropping it).

#### Scenario: Single-click on a branch
- **WHEN** the user single-clicks a branch row
- **THEN** the row is shown as selected and no checkout occurs

#### Scenario: Double-click on a local branch
- **WHEN** the user double-clicks a local branch
- **THEN** the app runs `git checkout <branch>` and the current-branch indicator updates on success

#### Scenario: Double-click on a remote branch
- **WHEN** the user double-clicks a remote branch `origin/feature-x`
- **THEN** the app checks out `feature-x` (creating a local tracking branch if it does not yet exist)

#### Scenario: Double-click on a stash
- **WHEN** the user double-clicks a stash
- **THEN** the stash is applied to the working tree and remains in the stash list
