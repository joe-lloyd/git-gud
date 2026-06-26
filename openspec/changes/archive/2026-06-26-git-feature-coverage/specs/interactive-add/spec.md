## ADDED Requirements

### Requirement: Keyboard shortcuts inside DiffViewer
The DiffViewer SHALL accept keyboard shortcuts when it has focus:
- `j` / `ArrowDown`: move focus to the next hunk header
- `k` / `ArrowUp`: move focus to the previous hunk header
- `s`: stage the focused hunk
- `Shift+S`: stage all hunks in the current file
- `d`: arm discard on the focused hunk; pressing `d` again within 3s discards
- `Shift+D`: arm discard on all hunks; pressing `Shift+D` again within 3s discards everything in the file
- `Escape`: close the DiffViewer

The focused hunk SHALL be visually distinct (focus ring or highlighted hunk header).

#### Scenario: j/k moves between hunks
- **WHEN** the DiffViewer is open with multiple hunks
- **AND** the user presses `j`
- **THEN** focus moves to the next hunk header and the body scrolls if needed

#### Scenario: s stages focused hunk
- **WHEN** focus is on a hunk header in unstaged mode
- **AND** the user presses `s`
- **THEN** that hunk is staged via the existing applyPatch mechanism
- **AND** the diff refreshes

#### Scenario: d twice discards
- **WHEN** the user presses `d` on a hunk
- **THEN** the discard control for that hunk is armed (visual feedback)
- **WHEN** the user presses `d` again within 3 seconds
- **THEN** the hunk is discarded
- **WHEN** 3 seconds elapse without a second press
- **THEN** the armed state clears

### Requirement: Per-line stage/discard remains accessible
The existing per-line stage (click on +/− sign) SHALL be preserved. A new per-line discard SHALL be added: holding Alt while clicking the +/− sign discards that single line instead of staging it. This is in addition to the keyboard flow.

#### Scenario: Alt-click discards a single line
- **WHEN** the user Alt-clicks a `+` sign in unstaged mode
- **THEN** that single line's change is discarded from the working tree

### Requirement: Focus indicator distinct from selection
The focused hunk SHALL use the global `:focus-visible` style (1.5px blue ring around the hunk header), distinct from any "selected" or "armed" state.

#### Scenario: Tab into the diff shows focus ring
- **WHEN** the user tabs into the DiffViewer from elsewhere in the app
- **THEN** the first hunk header (or whichever is current) shows a visible focus ring

### Requirement: Header bar shows shortcut hints
The DiffViewer header SHALL include a compact "?" button that toggles a small overlay listing the keyboard shortcuts. The overlay closes on Escape or by clicking outside.

#### Scenario: ? toggles the shortcut overlay
- **WHEN** the user clicks "?" in the DiffViewer header
- **THEN** a compact list of shortcuts appears

#### Scenario: Escape closes the overlay
- **WHEN** the shortcut overlay is open and the user presses Escape
- **THEN** the overlay closes but the DiffViewer remains open
