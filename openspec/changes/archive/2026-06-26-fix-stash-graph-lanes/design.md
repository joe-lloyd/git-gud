## Context

`buildGraphLayout` assigns each commit a lane in a single pass (newest → oldest). A commit frees its own lane at the start of processing, and only re-occupies it if its first parent continues down that column. When a commit instead forks its parent to an already-claimed lane, its own column is freed and never recorded in `activeLanes` — so `activeLanes.length` undercounts which columns have been used. A following stash, placed via `findFreeLane`, then reused that freed column and ran its line down to its base, visually fusing with the unrelated commit above it.

## Goals / Non-Goals

**Goals:** isolate stash nodes into their own column so they never look connected to unrelated commits; preserve all other lane behavior and stash styling.

**Non-Goals:** changing non-stash lane compaction; pushing stash-internal parent commits (index/untracked) fully to the side (they don't cause the false connection).

## Decisions

- **Track `maxLaneSeen`** — the highest lane index assigned to any node or parent, including transient/forked use that `activeLanes.length` misses. A stash takes `maxLaneSeen + 1`: a column to the right of everything seen, guaranteed not to collide with any neighbor's lane.
  - *Alternative*: exclude the previous row's lane in `findFreeLane`. Rejected — fragile and still risks collisions with active lines.
- **Operate on the stash's own lane, not its parent's.** An earlier attempt moved the stash's *base* commit, which was wrong (it shifted a real commit and didn't fix the adjacency).

## Risks / Trade-offs

- A stash always lands in a fresh rightmost column → slightly wider graph when stashes exist. Acceptable, and arguably clearer ("this dangles off to the side"). Verified against the real repo: `962813e` stays in its lane; stash `aeeea97` moves to its own.

## Migration Plan

Renderer-only; ship and it hot-reloads. Rollback = revert.
