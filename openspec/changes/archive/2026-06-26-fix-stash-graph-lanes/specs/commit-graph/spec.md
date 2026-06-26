## ADDED Requirements

### Requirement: Stash nodes occupy a dedicated column

A stash node SHALL be laid out in its own dedicated lane — positioned to the right of the highest lane used so far — so it never reuses a lane that an unrelated commit transiently vacated. This prevents a stash from appearing as a child of, or otherwise connected to, an unrelated commit that happens to sit directly above it. Stash styling (diamond node, dashed links) is unaffected; only column placement is governed by this requirement.

#### Scenario: Stash does not reuse an unrelated freed lane

- **WHEN** a commit forks its parent into a different lane (freeing its own column) and a stash node follows immediately below
- **THEN** the stash is placed in its own column, not the freed lane, so the two are not visually connected

#### Scenario: Stash dangles off the trunk

- **WHEN** the graph shows a stash alongside a linear trunk
- **THEN** the trunk commits keep their lanes and the stash occupies a separate column, connected only to its own base by a dashed link
