## ADDED Requirements

### Requirement: Bottom console dock

The application SHALL provide a console dock at the bottom of the main window, spanning the full width, that holds two side-by-side consoles (command console on the left, git activity log on the right). The dock SHALL be toggleable (shown/hidden) from a control in the app chrome.

#### Scenario: Toggle the dock

- **WHEN** the user activates the console toggle
- **THEN** the dock appears at the bottom with both consoles, and activating it again hides the dock

#### Scenario: Dock only with a repo open

- **WHEN** no repository is open
- **THEN** the dock is unavailable (the consoles operate on a repo/worktree)

#### Scenario: Visible by default

- **WHEN** the user has never explicitly hidden the dock
- **THEN** the dock is shown by default; it is only hidden if the user previously closed it (the hidden state persists)

### Requirement: Vertical resize of the dock

The dock height SHALL be adjustable by dragging a horizontal handle on its top edge, clamped to a sensible minimum and maximum, using the same handle affordance as the other panels.

#### Scenario: Drag dock taller/shorter

- **WHEN** the user drags the dock's top handle up or down
- **THEN** the dock height changes within its min/max bounds and the consoles reflow

### Requirement: Horizontal resize of the split

The split between the command console and the git log SHALL be adjustable by dragging a vertical handle between them, clamped so neither console collapses below a usable minimum.

#### Scenario: Drag the split left/right

- **WHEN** the user drags the handle between the two consoles
- **THEN** the left/right widths change accordingly, each retaining a minimum width

### Requirement: Persisted dock layout

The dock's visibility, height, and split position SHALL persist across sessions.

#### Scenario: Layout restored on launch

- **WHEN** the user has shown the dock and set its height/split, then relaunches the app
- **THEN** the dock reopens with the same visibility, height, and split
