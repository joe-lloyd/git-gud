# workspace-layout Specification

## Purpose
TBD - created by archiving change establish-baseline-spec. Update Purpose after archive.
## Requirements
### Requirement: Resizable right panel

The application SHALL let the user resize the right-hand panel (commit detail / working tree / multi-select detail) by dragging a vertical handle on its left edge, and SHALL persist the chosen width across sessions.

#### Scenario: Drag to resize

- **WHEN** the user drags the handle between the graph and the right panel
- **THEN** the right panel width follows the pointer, clamped to a minimum of 240px and bounded so the graph keeps at least 320px

#### Scenario: Width persists

- **WHEN** the user has resized the right panel and relaunches the app
- **THEN** the right panel opens at the previously chosen width

### Requirement: Resizable left sidebar

The application SHALL let the user resize the left sidebar by dragging a vertical handle on its right edge, SHALL keep dependent chrome (the advanced-feature bar) the same width as the sidebar, and SHALL persist the width.

#### Scenario: Drag to resize the sidebar

- **WHEN** the user drags the handle on the sidebar's right edge
- **THEN** the sidebar width follows the pointer (clamped between 180px and 600px) and the advanced bar beneath it matches that width

#### Scenario: Sidebar width persists

- **WHEN** the user has resized the sidebar and relaunches the app
- **THEN** the sidebar opens at the previously chosen width

### Requirement: Resizable, scrollable sidebar sections

The sidebar SHALL present Local Branches, Remote Branches, Stashes, and Worktrees as independent sections, each with its own scroll area and a drag handle between sections that resizes the section above it. Local Branches SHALL be a single scrollable list of every local branch. Section heights SHALL persist.

#### Scenario: Resize a section

- **WHEN** the user drags the handle below a sidebar section
- **THEN** that section's body height changes (clamped to a sensible min/max) and its content scrolls within the new height

#### Scenario: All local branches are listed

- **WHEN** the repository has more local branches than fit the section height
- **THEN** every local branch is reachable by scrolling the Local Branches section (no truncated "peek" list)

#### Scenario: Section heights persist

- **WHEN** the user has resized sidebar sections and relaunches the app
- **THEN** the sections reopen at their saved heights

### Requirement: Consistent resize-handle affordance

All panel/section resize handles SHALL share one visual style (a thin bar with a centered grip) and present the correct resize cursor for their axis.

#### Scenario: Handle cursor

- **WHEN** the user hovers a horizontal (between sidebar sections) or vertical (between panels) resize handle
- **THEN** the cursor indicates row-resize or col-resize respectively, and the handle highlights on hover

