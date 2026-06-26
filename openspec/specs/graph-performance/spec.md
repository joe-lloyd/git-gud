# graph-performance Specification

## Purpose
TBD - created by archiving change gitkraken-clone-audit-and-complete. Update Purpose after archive.
## Requirements
### Requirement: Initial graph paint within budget for large histories

For a repo with up to 10,000 commits loaded into memory, the time from receiving the `getLog` IPC response to the first frame showing the populated graph SHALL be ≤ 250 ms on a 2019-class MacBook Pro (Intel i9, 16 GB RAM) running a release build.

#### Scenario: 10k-commit repo initial paint
- **GIVEN** a repository with 10,000 reachable commits
- **WHEN** the user opens the repo
- **THEN** the graph (canvas + visible rows) appears within 250 ms after the log response arrives

### Requirement: Scroll maintains 60 fps frame budget

While scrolling the graph in a 10,000-commit repo, the renderer SHALL maintain at least 55 fps (≤ 18 ms per frame, 95th percentile) with no frame exceeding 33 ms (30 fps floor).

#### Scenario: Continuous scroll measurement
- **GIVEN** a 10,000-commit repo loaded in the graph
- **WHEN** the user holds the scroll wheel or trackpad scroll for at least 5 seconds
- **THEN** the 95th-percentile frame time stays ≤ 18 ms and no individual frame exceeds 33 ms

### Requirement: Layout work runs off the main thread above threshold

`buildGraphLayout` SHALL execute on the main thread for commit counts ≤ 5,000 and SHALL be delegated to a Web Worker for commit counts > 5,000. The threshold MUST be a single, configurable constant.

#### Scenario: Below threshold runs synchronously
- **WHEN** a repo with 4,000 commits loads
- **THEN** the layout computes on the main thread without a worker boundary

#### Scenario: Above threshold runs in a worker
- **WHEN** a repo with 8,000 commits loads
- **THEN** the layout computation is delegated to a Web Worker and the result is posted back to the renderer
- **AND** the main thread remains responsive to user input during computation (no scroll/click stall > 100 ms)

### Requirement: Canvas draws are viewport-clipped

The canvas SHALL only iterate node-draw work over the `[startRow, endRow]` window with the configured overscan; it MUST NOT iterate over the full commit array during any frame triggered by scroll, hover, or selection change.

#### Scenario: Scroll triggers only viewport work
- **WHEN** the user scrolls
- **THEN** the canvas drawing loop iterates only over visible + overscan rows
- **AND** layout is NOT recomputed

