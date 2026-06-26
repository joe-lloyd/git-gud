# commit-graph Specification

## Purpose
TBD - created by archiving change establish-baseline-spec. Update Purpose after archive.
## Requirements
### Requirement: Virtualized commit rows

The commit graph SHALL render commit rows virtualized (only the visible band plus a small overscan) so large histories stay responsive, while the scrollable area reflects the full commit count.

#### Scenario: Large history scrolls smoothly

- **WHEN** a repository with thousands of commits is displayed and the user scrolls
- **THEN** only rows near the viewport are mounted, and the scrollbar represents the full history height

### Requirement: Scroll-synced graph rendering

The canvas layer (lane lines and nodes) SHALL repaint in lockstep with native scrolling via animation frames reading the live scroll offset, so the graph does not visibly lag behind the commit rows.

#### Scenario: No lag during scroll

- **WHEN** the user scrolls the graph quickly
- **THEN** the drawn lines and nodes track the rows without a perceptible delay

### Requirement: Connector lines never disappear mid-scroll

The graph SHALL draw any connector whose segment crosses the viewport, even when both of its endpoint rows are scrolled outside the virtualized band, so lines never vanish while their nodes are off-screen.

#### Scenario: Long edge stays visible

- **WHEN** a commit's parent is far enough away that one endpoint is scrolled off-screen
- **THEN** the connector between them remains drawn wherever it crosses the visible area

### Requirement: Ring nodes sized to the row band

Commit nodes SHALL render as ring circles (thin lane-colored border, neutral interior reserved for future avatars) whose diameter matches the per-row highlight band height.

#### Scenario: Node appearance

- **WHEN** a commit row is drawn
- **THEN** its node is a ring of the lane color with an open center, the same diameter as the row's connector band

### Requirement: Per-row connector band

Each commit row SHALL show a band that fills the space from the node out to the start of the message text, tucked behind the node, colored by the lane, with a square right edge capped by a solid vertical end-line in the node color. Hover and selection SHALL change only the row background, not the band fill.

#### Scenario: Band emerges from the node

- **WHEN** a commit row is shown
- **THEN** a lane-colored band runs from behind the node to the message, ending in a vertical end-cap line, and the band keeps its color when the row is hovered or selected

### Requirement: Collapsed ref pills with overflow

When a commit carries more than one ref, the graph SHALL show one representative pill plus a `+N` overflow chip; hovering the chip SHALL reveal all pills (branch, HEAD, tag, remote, worktree). A single ref SHALL render as just that pill.

#### Scenario: Many refs collapse

- **WHEN** a commit has multiple refs
- **THEN** the row shows one pill and a `+N` chip, and hovering the chip shows every ref pill in a popover

#### Scenario: Single ref

- **WHEN** a commit has exactly one ref
- **THEN** that single pill is shown with no overflow chip

### Requirement: Commit selection modifiers

Clicking a commit SHALL select it singly; Shift-click SHALL select the contiguous range from the anchor to the clicked commit; ⌘/Ctrl-click SHALL toggle a commit in/out of the selection. All selected commits SHALL be highlighted.

#### Scenario: Shift range

- **WHEN** the user clicks one commit then Shift-clicks another
- **THEN** every commit between them (inclusive, by row order) becomes selected and highlighted

#### Scenario: Toggle

- **WHEN** the user ⌘/Ctrl-clicks commits
- **THEN** each toggles its membership in the selection without clearing the others

### Requirement: Auto-scroll only on sidebar reference selection

The graph SHALL scroll a commit into view ONLY when a branch, tag, or stash is chosen in the sidebar. Selecting a commit by clicking the graph (including range/toggle multi-select) SHALL NOT auto-scroll.

#### Scenario: Sidebar selection scrolls

- **WHEN** the user selects a branch, tag, or stash in the sidebar whose commit is off-screen
- **THEN** the graph scrolls that commit into view

#### Scenario: Graph click does not scroll

- **WHEN** the user clicks (or shift/⌘-clicks) commits directly in the graph
- **THEN** the graph does not auto-scroll

### Requirement: Stash nodes occupy a dedicated column

A stash node SHALL be laid out in its own dedicated lane — positioned to the right of the highest lane used so far — so it never reuses a lane that an unrelated commit transiently vacated. This prevents a stash from appearing as a child of, or otherwise connected to, an unrelated commit that happens to sit directly above it. Stash styling (diamond node, dashed links) is unaffected; only column placement is governed by this requirement.

#### Scenario: Stash does not reuse an unrelated freed lane

- **WHEN** a commit forks its parent into a different lane (freeing its own column) and a stash node follows immediately below
- **THEN** the stash is placed in its own column, not the freed lane, so the two are not visually connected

#### Scenario: Stash dangles off the trunk

- **WHEN** the graph shows a stash alongside a linear trunk
- **THEN** the trunk commits keep their lanes and the stash occupies a separate column, connected only to its own base by a dashed link

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

