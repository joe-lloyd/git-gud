# context-menus Specification

## Purpose
TBD - created by archiving change clone-audit-and-complete. Update Purpose after archive.
## Requirements
### Requirement: Right-click on a commit node opens the commit context menu

Right-clicking a commit node (in the graph) SHALL open a context menu with at least the following entries: **Create branch here**, **Cherry-pick commit**, **Reset current branch to this commit** (with submenu: Soft / Mixed / Hard), and **Revert commit**.

#### Scenario: Reset submenu is exposed
- **WHEN** the user right-clicks a commit
- **THEN** the menu contains three Reset options labeled `Soft`, `Mixed`, and `Hard`
- **AND** the Hard option is styled as destructive and triggers a confirmation modal before execution

#### Scenario: Revert commit
- **WHEN** the user chooses Revert from the menu
- **THEN** the app runs `git revert <sha>` against the current branch and shows the outcome via toast

#### Scenario: Create branch here
- **WHEN** the user chooses Create branch here
- **THEN** a name-input modal opens; on confirm the app runs `git branch <name> <sha>` and refreshes the sidebar

### Requirement: Right-click on a branch opens the branch context menu

Right-clicking a branch entry (in the sidebar or on a ref pill in the graph) SHALL open a context menu with at least: **Checkout [branch_name]**, **Rename [branch_name]**, **Delete [branch_name]**, **Push to remote**, **Pull from remote**.

#### Scenario: Rename branch
- **WHEN** the user chooses Rename
- **THEN** an input modal opens prefilled with the current branch name
- **AND** on confirm the app runs `git branch -m <old> <new>` and refreshes

#### Scenario: Delete branch with safety check
- **WHEN** the user chooses Delete on a branch that is not fully merged
- **THEN** the app first attempts `git branch -d`, and on rejection prompts the user with a force-delete confirmation before running `git branch -D`

#### Scenario: Remote branch shows tracking-aware actions
- **WHEN** the right-clicked branch is a remote-tracking ref (e.g. `origin/feature-x`)
- **THEN** the menu's Checkout entry creates the local tracking branch if needed
- **AND** Delete operates on the remote ref via `git push origin --delete <branch>` after a confirmation modal

### Requirement: Right-click on a stash opens the stash context menu

Right-clicking a stash entry SHALL open a context menu with: **Apply stash**, **Pop stash**, **Drop stash**.

#### Scenario: Drop with confirmation
- **WHEN** the user chooses Drop
- **THEN** a confirmation modal asks for explicit confirmation
- **AND** only on confirm does `git stash drop stash@{n}` run

#### Scenario: Apply vs Pop
- **WHEN** the user chooses Apply
- **THEN** the stash is applied and remains in the stash list
- **WHEN** the user chooses Pop
- **THEN** the stash is applied and removed from the stash list

### Requirement: Context menus are theme-styled and dismissible

Every context menu SHALL use the application's dark/light theme tokens. Menus SHALL dismiss on: outside click, `Esc`, the next context-menu open, or window blur.

#### Scenario: Esc dismisses an open menu
- **WHEN** a context menu is open
- **AND** the user presses Esc
- **THEN** the menu closes without performing any action

#### Scenario: Outside click dismisses the menu
- **WHEN** a context menu is open
- **AND** the user clicks anywhere outside it
- **THEN** the menu closes; if the click hit an actionable target, that target receives the click

