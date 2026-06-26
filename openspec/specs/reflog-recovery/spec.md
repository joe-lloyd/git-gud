# reflog-recovery Specification

## Purpose
TBD - created by archiving change git-feature-coverage. Update Purpose after archive.
## Requirements
### Requirement: Reflog panel in the right column
The system SHALL provide a Reflog panel that swaps into the right column (same slot as Bisect/CommitDetail/WorkingTree). The panel is opened from a Toolbar button labeled "Reflog" and closed via its own × close button or by selecting a real commit (which switches to CommitDetail).

#### Scenario: Toolbar button opens the panel
- **WHEN** the user clicks the Reflog Toolbar button
- **THEN** the right column shows the Reflog panel
- **AND** the panel lists reflog entries newest-first

#### Scenario: Closing the panel returns to default
- **WHEN** the user closes the Reflog panel
- **THEN** the right column reverts to WorkingTree (if dirty + no commit selected) or CommitDetail

### Requirement: Each reflog entry shows action, SHA, message
Each row SHALL display: the short SHA, the action label (commit / reset / checkout / merge / cherry-pick / rebase / etc.), the message git recorded, and a relative timestamp.

#### Scenario: Row format
- **WHEN** the panel renders an entry for `HEAD@{5}: reset: moving to v1.0`
- **THEN** the row shows `abc1234 · reset · "moving to v1.0" · 2h ago`

### Requirement: "Restore HEAD here" action with confirm
Each entry SHALL have a "Restore HEAD here" button. Clicking it opens a ConfirmModal: "Reset HEAD to <short-sha>. This will discard any commits made after this point. Continue?" Confirming runs `git reset --hard <sha>`.

#### Scenario: Restore prompts before resetting
- **WHEN** the user clicks "Restore HEAD here" on an entry
- **THEN** a ConfirmModal appears with explicit copy describing what is lost
- **AND** the action only runs if the user confirms

#### Scenario: Restore refreshes the graph
- **WHEN** the restore confirms successfully
- **THEN** the commit graph refreshes
- **AND** HEAD now points at the chosen SHA
- **AND** a success toast confirms the action

### Requirement: "Copy SHA" non-destructive option
Each entry SHALL also expose a "Copy SHA" button that copies the full SHA to clipboard without modifying the repo.

#### Scenario: Copy works without confirm
- **WHEN** the user clicks "Copy SHA"
- **THEN** the full SHA is in the clipboard
- **AND** a brief toast confirms

### Requirement: Keyboard navigation in the reflog list
Arrow keys SHALL move focus between entries; Enter SHALL trigger the focused entry's primary action (Restore — with confirm); `c` SHALL trigger Copy SHA.

#### Scenario: Arrow keys move focus
- **WHEN** focus is in the reflog list and the user presses ArrowDown
- **THEN** focus moves to the next entry

#### Scenario: Enter triggers restore with confirm
- **WHEN** focus is on an entry and the user presses Enter
- **THEN** the ConfirmModal for restore opens

