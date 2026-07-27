/**
 * Graph layout algorithm.
 * Assigns each commit to a "lane" (column) for rendering.
 * Produces colored lanes with bezier curves connecting parents.
 */

import type { CommitNode } from '../../preload/index'

export interface GraphNode {
  commit: CommitNode
  lane: number        // column index
  color: string       // CSS color string
  row: number         // row index (0 = newest)
  parentConnections: ParentConnection[]
}

export interface ParentConnection {
  parentSha: string
  parentRow: number   // -1 if parent not in current view
  parentLane: number
  color: string
  type: 'merge' | 'straight' | 'fork'
}

// Neon-pink first, then warm/cool alternating so adjacent branch lanes stay
// distinct. Keep in sync with the --lane-N vars in global.css.
const LANE_COLORS = [
  '#ff4fc3', // neon hot pink (brand / main branch)
  '#4fd1c5', // teal
  '#f6ad55', // amber
  '#9f7aea', // indigo
  '#68d391', // green
  '#fc8181', // coral
  '#76e4f7', // cyan
  '#f6e05e', // yellow
  '#b794f4', // purple
  '#fb923c', // orange
]

export function getLaneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length]
}

/**
 * Sweep-line lane assignment over the (already child-before-parent ordered)
 * commit list, newest → oldest.
 *
 * The core invariant is that a lane is reserved for every row an edge actually
 * *draws through*, not just for the rows between a commit and a same-lane
 * parent. GraphCanvas renders the two edge shapes like this:
 *
 *   fork  (child lane ≠ parent lane, first parent):
 *         vertical down the CHILD's lane → elbow at the parent's row → across
 *   merge (second+ parent):
 *         across at the CHILD's row → elbow → vertical down the PARENT's lane
 *
 * So a fork keeps the child's own column busy all the way down to the parent
 * row. The previous implementation freed it immediately, which let an unrelated
 * commit land in that column with the fork line running straight through its
 * node — reading as a parent/child link that doesn't exist (bug 1).
 */
export function buildGraphLayout(
  commits: CommitNode[],
  stashShas: Set<string> = new Set(),
): GraphNode[] {
  const shaToRow = new Map<string, number>()
  commits.forEach((c, i) => shaToRow.set(c.sha, i))

  // Final lane/color per commit. Lanes for parents are pencilled in when a
  // child claims them and may be revised (leftward) when the parent's own row
  // is reached, so connections are only materialised in the second pass below.
  const shaToLane = new Map<string, number>()
  const shaToColor = new Map<string, string>()

  // busyUntil[i] = last row index (inclusive) through which lane i carries a
  // line. Lane i is free at row r when busyUntil[i] < r.
  const busyUntil: number[] = []
  const isFree = (lane: number, row: number): boolean => (busyUntil[lane] ?? -1) < row
  const reserve = (lane: number, until: number): void => {
    while (busyUntil.length <= lane) busyUntil.push(-1)
    if (busyUntil[lane] < until) busyUntil[lane] = until
  }
  // Lowest column with no line running through it at `row` — keeps the graph
  // compressed to the left rather than sprawling rightward. Columns past the
  // end of `busyUntil` are free, so this always terminates.
  const findFreeLane = (row: number, exclude?: Set<number>): number => {
    for (let i = 0; ; i++) {
      if (!exclude?.has(i) && isFree(i, row)) return i
    }
  }

  // Highest lane index handed out so far. A lane can be used transiently, so
  // busyUntil.length alone undercounts. Stashes use this to claim a column to
  // the right of everything seen — guaranteeing they never share a lane with
  // an unrelated neighbour.
  let maxLaneSeen = -1

  // sha → topmost row of a child that reaches it as a MERGE parent (2nd+). Such
  // an edge runs vertically down the PARENT's column from that child's row, so
  // the parent can only compact into a column that has been free that whole
  // way — otherwise the relocated line would cut through commits above it.
  const mergeSpanFrom = new Map<string, number>()

  const laneOfRow: number[] = new Array(commits.length)

  // ── Pass 1: lanes ───────────────────────────────────────────────────────
  for (let row = 0; row < commits.length; row++) {
    const { sha, parents } = commits[row]
    const isStash = stashShas.has(sha)

    let lane: number
    const claimed = shaToLane.get(sha)
    if (claimed !== undefined) {
      lane = claimed
      // Lane compaction: once the columns to our left have gone idle there is
      // nothing left to route around, so slide in to fill them. Only the
      // contiguous free run immediately left of us is eligible — stopping at
      // the first busy column keeps the elbow from crossing a live line.
      if (!isStash) {
        const spanFrom = mergeSpanFrom.get(sha)
        const canTake = (l: number): boolean =>
          spanFrom === undefined ? isFree(l, row) : (busyUntil[l] ?? -1) < spanFrom
        while (lane > 0 && canTake(lane - 1)) lane--
      }
    } else if (isStash) {
      // A stash is an unrelated dangling node. If it reuses a just-freed lane
      // it lands directly under whatever commit vacated that column and its
      // line continues down, making the two look connected (a stash "child" of
      // an unrelated commit). Give every stash a column to the right of
      // everything seen so far.
      lane = maxLaneSeen + 1
    } else {
      lane = findFreeLane(row)
    }

    shaToLane.set(sha, lane)
    laneOfRow[row] = lane
    reserve(lane, row)
    if (lane > maxLaneSeen) maxLaneSeen = lane

    const color = shaToColor.get(sha) ?? getLaneColor(lane)
    shaToColor.set(sha, color)

    // `usedLanes` holds this commit's own lane plus any sibling parent lanes so
    // a merged-in branch can't collapse on top of them.
    const usedLanes = new Set<number>([lane])

    parents.forEach((parentSha, pi) => {
      const parentRow = shaToRow.get(parentSha) ?? -1
      // Parent is outside the loaded window — nothing is drawn for it, so it
      // neither needs a column nor may consume one.
      if (parentRow < 0) return

      let parentLane = shaToLane.get(parentSha)
      if (parentLane === undefined) {
        // First parent continues in this commit's lane (mainline lineage) and
        // inherits its colour so a branch keeps one hue end to end. Stashes lay
        // out exactly like regular commits here — only their rendering (diamond
        // node, dashed links) differs, handled in GraphView.
        parentLane = pi === 0 ? lane : findFreeLane(row, usedLanes)
        shaToLane.set(parentSha, parentLane)
        shaToColor.set(parentSha, pi === 0 ? color : getLaneColor(parentLane))
      }
      usedLanes.add(parentLane)
      if (parentLane > maxLaneSeen) maxLaneSeen = parentLane

      // Hold every column the edge draws through, down to the parent's row.
      if (pi === 0) {
        // Straight or fork: the vertical run is in OUR lane.
        reserve(lane, parentRow)
        reserve(parentLane, parentRow)
      } else {
        // Merge: the vertical run is in the PARENT's lane.
        reserve(parentLane, parentRow)
        const seen = mergeSpanFrom.get(parentSha)
        if (seen === undefined || row < seen) mergeSpanFrom.set(parentSha, row)
      }
    })
  }

  // ── Pass 2: connections ─────────────────────────────────────────────────
  // Every commit now has its final lane, so parent lanes read here already
  // account for any compaction that happened after a child claimed them.
  return commits.map((commit, row) => {
    const lane = laneOfRow[row]
    const color = shaToColor.get(commit.sha)!

    const parentConnections = commit.parents.map((parentSha, pi) => {
      const parentRow = shaToRow.get(parentSha) ?? -1
      const parentLane = parentRow < 0 ? lane : shaToLane.get(parentSha) ?? lane
      const parentColor = shaToColor.get(parentSha) ?? color
      return {
        parentSha,
        parentRow,
        parentLane,
        color: pi === 0 ? color : parentColor,
        type: (pi > 0
          ? 'merge'
          : commit.parents.length > 1 || lane !== parentLane
          ? 'fork'
          : 'straight') as ParentConnection['type'],
      }
    })

    return { commit, lane, color, row, parentConnections }
  })
}
