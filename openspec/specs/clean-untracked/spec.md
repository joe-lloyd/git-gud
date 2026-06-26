# clean-untracked Specification

## Purpose
TBD - created by archiving change git-feature-coverage. Update Purpose after archive.
## Requirements
### Requirement: Clean modal opened from Advanced bar
The Advanced bar SHALL include a "Clean…" button. Clicking it opens a CleanModal that previews and executes `git clean` with user-controlled scope.

#### Scenario: Button opens the modal
- **WHEN** the user clicks "Clean…" in the Advanced bar
- **THEN** the CleanModal opens with a dry-run preview of what would be deleted

### Requirement: Modal previews via `git clean --dry-run`
On open and whenever scope toggles change, the modal SHALL run `git clean --dry-run` with the currently-selected scope flags and list every file/directory that would be deleted. Each entry SHALL have a checkbox, all checked by default.

#### Scenario: Initial preview lists targets
- **WHEN** the modal opens
- **THEN** `git clean -nd` (and `-x` if "ignored" is enabled, `-X` if "ignored only") runs with --dry-run
- **AND** the result list renders one row per path with a default-checked checkbox

#### Scenario: Scope change re-previews
- **WHEN** the user toggles "Include ignored files"
- **THEN** the dry-run re-runs with the new flag and the list updates

### Requirement: Three scope toggles
The modal SHALL provide three independent toggles: "Untracked files" (default on), "Untracked directories" (default on, adds `-d`), and "Ignored files" (default off, adds `-x`).

#### Scenario: Scope toggles map to flags
- **WHEN** all three are enabled
- **THEN** the underlying command becomes `git clean -fdx`
- **WHEN** only "Untracked files" is enabled
- **THEN** the underlying command becomes `git clean -f`

### Requirement: Typed-confirm gate
The Confirm button SHALL be disabled until the user types the literal word `delete` (case-insensitive) into a confirmation field below the file list. This is in addition to the visible preview — discoverable friction, not arbitrary.

#### Scenario: Confirm disabled without typed confirmation
- **WHEN** the modal is open and the confirmation field is empty
- **THEN** the Confirm button is disabled

#### Scenario: Typing "delete" enables Confirm
- **WHEN** the user types "delete" into the confirmation field
- **THEN** the Confirm button becomes enabled

### Requirement: Per-file uncheck excludes from deletion
Unchecking a file row SHALL exclude it from the actual clean operation. The system SHALL run `git clean` with explicit paths (`-- path1 path2 …`) rather than a flag-only invocation, so unchecked files are preserved.

#### Scenario: Unchecked files survive
- **WHEN** the user unchecks one row and clicks Confirm
- **THEN** the clean command runs with the remaining checked paths only
- **AND** the unchecked file remains on disk

### Requirement: Post-clean refresh
After a successful clean, the WorkingTree status SHALL refresh and a toast SHALL summarize the count of files deleted.

#### Scenario: Successful clean reports count
- **WHEN** 5 files are deleted by the clean operation
- **THEN** a toast says "Cleaned 5 files."
- **AND** the WorkingTree untracked list updates to reflect the new state

