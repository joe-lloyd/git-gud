## 1. Fix

- [x] 1.1 In `graphLayout.ts`, track `maxLaneSeen` across node and parent lane assignments (covers transient/forked lane use that `activeLanes.length` misses).
- [x] 1.2 Assign a stash node `maxLaneSeen + 1` (its own dedicated rightmost column) instead of `findFreeLane`.
- [x] 1.3 `GraphView.tsx` passes the stash SHA set into `buildGraphLayout`.

## 2. Test

- [x] 2.1 Regression test reproducing the freed-lane-reuse scenario: a stash must not share the column of an unrelated commit that forked its parent away.
- [x] 2.2 Tests that the trunk is unperturbed and non-stash nodes are unaffected.
- [x] 2.3 Verified against the real repo data (`962813e` lane 2, stash `aeeea97` lane 3).
- [x] 2.4 `pnpm typecheck`, `pnpm build`, `pnpm test --run` pass (62 tests).
