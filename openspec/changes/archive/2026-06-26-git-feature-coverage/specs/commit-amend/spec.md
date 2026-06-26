## ADDED Requirements

### Requirement: Amend toggle on the working-tree commit box
The system SHALL expose an "Amend last commit" checkbox above the commit message textarea in the WorkingTree panel. When toggled on, the message field SHALL pre-fill with the last commit's full message, the submit button SHALL change to "Amend on `<branch>`", and submission SHALL run `git commit --amend` carrying forward whatever changes are staged.

#### Scenario: Toggle pre-fills the previous commit message
- **WHEN** the user checks "Amend last commit"
- **THEN** the message textarea is populated with the HEAD commit's full message (subject + body)
- **AND** the submit button label becomes "Amend on <current-branch>"

#### Scenario: Amend with no staged changes updates the message only
- **WHEN** the user toggles amend, edits the message, and clicks Amend
- **AND** nothing is staged
- **THEN** `git commit --amend -m <new-message>` runs
- **AND** HEAD's SHA changes but the tree is unchanged

#### Scenario: Amend with staged changes folds them into HEAD
- **WHEN** the user has staged files, toggles amend, and clicks Amend
- **THEN** the staged changes are folded into the previous commit and the message is updated

#### Scenario: Untoggling restores the editor state
- **WHEN** the user unchecks "Amend last commit"
- **THEN** the message textarea reverts to whatever it held before the toggle was activated (or empty)
- **AND** the submit button reverts to "Commit to <branch>"

### Requirement: Force-push warning when amending pushed commits
The system SHALL detect when HEAD is at-or-behind its upstream (i.e., already pushed) and display a yellow warning under the amend checkbox: "This commit has been pushed — amending will require force-push." The warning is informational only and SHALL NOT block submission.

#### Scenario: Pushed commit shows warning
- **WHEN** the user toggles amend
- **AND** `status.ahead === 0` for the current branch
- **THEN** a warning banner appears under the checkbox describing the force-push consequence

#### Scenario: Unpushed commit shows no warning
- **WHEN** the user toggles amend
- **AND** `status.ahead > 0`
- **THEN** no warning is shown

### Requirement: Amend respects keyboard navigation
The amend toggle, message textarea, and submit button SHALL be reachable via Tab from the file list and operable via keyboard (Space toggles checkbox, Enter inside textarea inserts newline, Ctrl/Cmd+Enter submits).

#### Scenario: Keyboard submission
- **WHEN** the amend checkbox is checked and the message field has content
- **AND** the user presses Ctrl/Cmd+Enter inside the textarea
- **THEN** the amend is submitted (same as clicking the button)
