## ADDED Requirements

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
