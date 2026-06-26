## ADDED Requirements

### Requirement: Word-diff toggle in DiffViewer header
The DiffViewer SHALL expose a "Word diff" toggle button in its header bar. When the toggle is on, the diff SHALL be re-fetched with `git diff --word-diff=porcelain` and rendered with word/character-level highlighting instead of line-level. The toggle state SHALL persist for the lifetime of the open viewer.

#### Scenario: Toggle on re-renders with word-level changes
- **WHEN** the user clicks the "Word diff" button in DiffViewer
- **THEN** the diff is re-fetched with `--word-diff=porcelain`
- **AND** the rendered diff shows inserted tokens with green styling and deleted tokens with red styling, inline within unchanged context

#### Scenario: Toggle off returns to line diff
- **WHEN** the user clicks "Word diff" while it is on
- **THEN** the diff re-fetches without the flag and renders line-by-line

#### Scenario: Word diff applies to both working-tree and commit diffs
- **WHEN** the toggle is on
- **AND** the DiffViewer is showing a commit diff (sha mode)
- **THEN** the commit diff also renders at word-level

### Requirement: Stage/discard hunk buttons are disabled in word-diff mode
Stage-chunk, discard-chunk, and per-line action buttons SHALL be hidden or disabled while word-diff is on, because porcelain word-diff doesn't carry clean per-hunk line boundaries that map back to the index.

#### Scenario: Word diff hides chunk buttons
- **WHEN** word-diff mode is on
- **THEN** no "Stage chunk" or "Discard chunk" buttons appear in hunk headers
- **AND** lines are not click-stageable

### Requirement: Parse failure falls back to line diff
If the word-diff porcelain output cannot be parsed (malformed, unexpected tokens), the system SHALL fall back to line diff rendering and surface a toast: "Word diff parse failed — showing line diff."

#### Scenario: Malformed porcelain output triggers fallback
- **WHEN** the renderer encounters porcelain output it cannot parse
- **THEN** the line-diff view is shown
- **AND** a non-modal toast informs the user of the fallback
