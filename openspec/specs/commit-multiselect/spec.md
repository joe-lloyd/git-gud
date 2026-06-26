# commit-multiselect Specification

## Purpose
TBD - created by archiving change establish-baseline-spec. Update Purpose after archive.
## Requirements
### Requirement: Multi-select detail panel

When two or more commits are selected, the right panel SHALL show a multi-select detail view instead of single-commit detail, listing the selected commits (newest first) with author/subject, the count, the number of distinct authors, whether the selection is contiguous, and — for a contiguous selection — a combined diffstat (files / insertions / deletions).

#### Scenario: Detail shown for multiple

- **WHEN** the user has 2+ commits selected
- **THEN** the right panel shows the count, the commit list, and (if contiguous) a combined diffstat

#### Scenario: Focus a single commit

- **WHEN** the user clicks a commit row in the multi-select detail list
- **THEN** the selection collapses to that single commit and normal commit detail is shown

### Requirement: Bulk commit operations

The application SHALL offer bulk operations on a multi-selection via a context menu and the detail panel: cherry-pick and revert (any selection), and squash and drop (contiguous selections only). Each operation SHALL act on real commits only (excluding the working-tree pseudo node and stashes), report success/failure via a toast, and refresh the view.

#### Scenario: Bulk cherry-pick

- **WHEN** the user selects commits and chooses Cherry-pick
- **THEN** the commits are applied to the current branch in a safe order, and the result is reported

#### Scenario: Squash gated on contiguity

- **WHEN** the selection is not an unbroken run in history
- **THEN** Squash and Drop are disabled (with an explanation), while Cherry-pick and Revert remain available

#### Scenario: Squash a contiguous range

- **WHEN** the user squashes a contiguous selection
- **THEN** the commits are combined into one (carrying their concatenated messages) and the graph refreshes

#### Scenario: Destructive confirm for drop

- **WHEN** the user chooses Drop
- **THEN** the user is asked to confirm before history is rewritten

### Requirement: Conflict-aware bulk results

When a bulk squash or drop leaves the repository mid-rebase due to conflicts, the application SHALL report the conflict (rather than a generic failure) and refresh so the conflict-resolution UI can take over.

#### Scenario: Squash hits a conflict

- **WHEN** replaying later commits during a squash/drop conflicts
- **THEN** the user is told conflicts occurred and is directed to resolve them in the panel

