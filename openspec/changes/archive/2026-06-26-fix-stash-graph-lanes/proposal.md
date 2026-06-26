## Why

In the commit graph, an unrelated stash could appear as a child of a real commit. A commit that forks its parent into another lane frees its own column without recording that the column was ever used (`activeLanes.length` undercounts transient use); the next stash then reused that freed lane and ran its line straight down to its base, so the column read as one continuous line through the commit and the stash. Observed in a real repo (`962813e` and stash `aeeea97` both in the same column with no relation).

## What Changes

- A stash node SHALL be placed in its own dedicated column — to the right of the highest lane used so far — so it can never reuse an unrelated commit's freed lane and look connected to it.
- Track the highest lane index actually assigned (including transient/forked use), since `activeLanes.length` alone undercounts.
- Stash styling (diamond node, dashed links) is unchanged; only column placement is corrected.

## Capabilities

### Modified Capabilities
- `commit-graph`: adds a requirement that stash nodes are laid out in a dedicated column, isolated from unrelated commits' lanes.

## Impact

- **Renderer** (`src/renderer/components/Graph/graphLayout.ts`): track `maxLaneSeen`; assign a stash `maxLaneSeen + 1`. `GraphView.tsx` passes the stash SHA set into `buildGraphLayout`.
- **Tests** (`src/renderer/test/graphLayout.test.ts`): regression reproducing the freed-lane-reuse scenario.
- No new dependencies. Already implemented and verified against the real repo data.
