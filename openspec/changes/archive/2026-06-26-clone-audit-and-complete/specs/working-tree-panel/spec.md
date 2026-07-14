## ADDED Requirements

### Requirement: Working-Tree panel shows split Unstaged / Staged lists

When the right panel is in Working-Tree mode, it SHALL render two clearly labeled lists: **Unstaged Files** (top) and **Staged Files** (bottom). Each row SHALL include the file path, a status indicator (M/A/D/R/?), and `+N / -N` line counts when available.

#### Scenario: Both lists render
- **WHEN** the working tree has both unstaged and staged changes
- **THEN** the panel shows both lists, each with their items and counts

#### Scenario: One list empty
- **WHEN** there are no staged changes
- **THEN** the Staged section header still renders and the body shows an "empty" placeholder

### Requirement: Per-file stage / unstage / discard controls

Each row SHALL expose actions appropriate to its position:
- **Unstaged row**: Stage, Discard.
- **Staged row**: Unstage.
- **Group headers**: Stage all unstaged, Unstage all staged.

#### Scenario: Stage a single file
- **WHEN** the user clicks Stage on an unstaged row
- **THEN** the file moves from Unstaged to Staged and the diff for that file (if open) updates to show the staged diff

#### Scenario: Discard a single file requires confirmation
- **WHEN** the user clicks Discard on an unstaged row
- **THEN** a confirmation modal warns that local changes will be lost
- **AND** only on confirm does the app run the discard (`git checkout -- <file>` or remove for untracked)

### Requirement: File diff opens a side-by-side or inline diff viewer

Clicking a file row SHALL open a diff viewer in the main area. The viewer SHALL default to side-by-side mode and SHALL expose a toggle to switch to inline mode. The viewer SHALL show added lines, removed lines, and context with syntax-aware coloring.

#### Scenario: Side-by-side default
- **WHEN** the user clicks a file row for the first time in a session
- **THEN** the diff viewer opens in side-by-side mode

#### Scenario: Toggle to inline
- **WHEN** the user toggles the viewer to inline mode
- **THEN** the same hunks render as a single column with `+` and `−` line prefixes and the preference persists for the rest of the session

#### Scenario: Untracked file
- **WHEN** the user clicks an untracked file row
- **THEN** the diff viewer shows the full file content as an addition against `/dev/null`

### Requirement: Commit form lives in the same panel

The Working-Tree panel SHALL include a commit form below the lists, consisting of: a single-line subject input, a multi-line description textarea, and a primary **Commit changes** button.

#### Scenario: Commit button disabled with empty staged list
- **WHEN** there are no staged files
- **THEN** the Commit changes button is disabled and the form shows a "Stage files to commit" hint

#### Scenario: Commit button disabled with empty subject
- **WHEN** the subject input is empty
- **THEN** the Commit changes button is disabled regardless of staged file count

#### Scenario: Successful commit clears the form
- **WHEN** the user clicks Commit changes with a non-empty subject and at least one staged file
- **THEN** the commit is created with `subject` (and optional `body`), the form clears, and both lists refresh
