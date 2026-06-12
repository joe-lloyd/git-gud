## ADDED Requirements

### Requirement: Branches render with consistent multi-color lanes

The commit graph SHALL assign each branch lane a color and reuse that color for every segment belonging to that branch across the visible history. Colors MUST be drawn from a fixed palette of at least 8 distinct hues with sufficient contrast against the dark background.

#### Scenario: Branch keeps its color across the visible window
- **WHEN** a branch spans multiple commits in the visible viewport
- **THEN** every connecting line and node belonging to that branch lane is drawn in the same color

#### Scenario: Distinct branches use distinct colors
- **WHEN** two or more branches are visible
- **THEN** each branch's lane is rendered in a different palette color, with no two adjacent lanes sharing a hue

### Requirement: Clicking a commit node populates the right-side detail panel

Clicking a commit (the node, the row, or any cell except a ref pill or interactive control) SHALL set the selected SHA. The right panel, when in Commit mode, SHALL show that commit's metadata, file list, and diff.

#### Scenario: Single-click selects a commit
- **WHEN** the user clicks a commit row
- **THEN** the node is rendered as selected (enlarged, with glow) and the right panel updates to that commit's details

#### Scenario: Clicking a ref pill does not select the commit
- **WHEN** the user clicks a ref pill on a commit row
- **THEN** the pill's action (or its menu) runs but the right-panel selection does not change unless the action explicitly sets it

### Requirement: Hovering a commit highlights its branch label

Hovering a commit node or row SHALL visually emphasize the ref pill(s) attached to that commit and, when the commit is reachable from a labeled branch tip, also emphasize the matching pill on that tip.

#### Scenario: Hover surfaces the branch
- **WHEN** the user hovers a commit
- **THEN** the relevant ref pill(s) gain a highlight style (e.g. brighter border / scaled-up shadow) for the duration of the hover

### Requirement: Dragging a branch pointer opens a Merge/Rebase/Checkout menu on drop

A ref pill representing a local or remote branch SHALL be draggable. Dropping it onto another ref pill (graph or sidebar) SHALL open a context menu with three options: **Merge**, **Rebase**, **Checkout**, each executing the corresponding git operation on the (source → target) pair.

#### Scenario: Drag local branch onto another local branch
- **WHEN** the user drags branch pill `feature-x` and drops it on pill `main`
- **THEN** a context menu opens at the cursor with options `Merge feature-x → main`, `Rebase feature-x onto main`, and `Checkout main`

#### Scenario: Choosing Merge runs the merge with autostash
- **GIVEN** the user has chosen Merge from the drag menu
- **WHEN** the working tree is dirty
- **THEN** the app auto-stashes, performs the merge, restores the stash, and reports the outcome via toast
- **AND** the original branch is checked out at the end (success or failure)

#### Scenario: Choosing Checkout from the drag menu
- **WHEN** the user chooses Checkout on the drop target
- **THEN** the app checks out the drop target branch
- **AND** the toolbar current-branch indicator updates accordingly

#### Scenario: Drag is cancelled on Esc
- **WHEN** the user presses Esc while dragging or while the drop menu is open
- **THEN** no git operation runs and no menu remains visible
