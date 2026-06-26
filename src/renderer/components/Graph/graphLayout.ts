/**
 * Graph layout algorithm.
 * Assigns each commit to a "lane" (column) for rendering.
 * Produces GitKraken-style colored lanes with bezier curves connecting parents.
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

export function buildGraphLayout(
  commits: CommitNode[],
  stashShas: Set<string> = new Set(),
): GraphNode[] {
  const nodes: GraphNode[] = []
  const shaToRow = new Map<string, number>()
  const shaToLane = new Map<string, number>()
  const shaToColor = new Map<string, string>()

  // Build sha → row index
  commits.forEach((c, i) => shaToRow.set(c.sha, i))

  // Track which lanes are "occupied" at each row
  // activeLanes[lane] = sha of commit whose line is currently running through it
  const activeLanes: (string | null)[] = []

  // Highest lane index assigned to ANY node or parent so far. A lane can be used
  // transiently (a commit forks its parent elsewhere, never persisting its own
  // column in activeLanes), so activeLanes.length alone undercounts. Stashes use
  // this to claim a column to the right of everything seen — guaranteeing they
  // never share a lane with an unrelated neighbour.
  let maxLaneSeen = -1

  // Lowest currently-free lane. activeLanes[i] === null means no commit's line
  // is passing through column i, so reuse is safe — keeps the graph compressed
  // to the left rather than sprawling rightward.
  const findFreeLane = (exclude: Set<number> = new Set()): number => {
    for (let i = 0; i < activeLanes.length; i++) {
      if (!exclude.has(i) && activeLanes[i] === null) return i
    }
    return activeLanes.length
  }

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row]
    const { sha, parents } = commit
    const isStash = stashShas.has(sha)

    // Determine this commit's lane.
    let lane: number
    if (shaToLane.has(sha)) {
      lane = shaToLane.get(sha)!
    } else if (isStash) {
      // A stash is an unrelated dangling node. If it reuses a just-freed lane it
      // lands directly under whatever commit vacated that column and its line
      // continues down, making the two look connected (a stash "child" of an
      // unrelated commit). Give every stash a column to the right of everything
      // seen so far so it can never merge into a neighbour's lane.
      lane = maxLaneSeen + 1
    } else {
      lane = findFreeLane()
    }
    if (lane > maxLaneSeen) maxLaneSeen = lane

    // Assign color based on lane (inherit from first child if possible)
    let color: string
    if (shaToColor.has(sha)) {
      color = shaToColor.get(sha)!
    } else {
      color = getLaneColor(lane)
    }

    shaToLane.set(sha, lane)
    shaToColor.set(sha, color)

    // Free the lane for this commit
    if (lane < activeLanes.length) {
      activeLanes[lane] = null
    }

    // Build parent connections
    const parentConnections: ParentConnection[] = []
    const usedLanes = new Set<number>()

    parents.forEach((parentSha, pi) => {
      const parentRow = shaToRow.get(parentSha) ?? -1

      let parentLane: number
      if (shaToLane.has(parentSha)) {
        // Another child already claimed this parent — respect that lane
        parentLane = shaToLane.get(parentSha)!
      } else if (pi === 0) {
        // First parent continues in this commit's lane (mainline lineage).
        // Stashes are laid out exactly like regular commits here — only their
        // rendering (diamond node, dashed links) differs, handled in GraphView.
        parentLane = lane
        shaToLane.set(parentSha, parentLane)
        shaToColor.set(parentSha, color)
      } else {
        // Merge parent (second+) — slot into the leftmost truly-free column.
        // `usedLanes` excludes this commit's own lane and any sibling parent
        // lanes, so the merged-in branch can't collapse on top of them.
        parentLane = findFreeLane(usedLanes)
        shaToLane.set(parentSha, parentLane)
        shaToColor.set(parentSha, getLaneColor(parentLane))
      }

      usedLanes.add(parentLane)
      if (parentLane > maxLaneSeen) maxLaneSeen = parentLane

      const parentColor = shaToColor.get(parentSha) ?? color
      const connType = pi > 0 ? 'merge' : parents.length > 1 || lane !== parentLane ? 'fork' : 'straight'

      parentConnections.push({
        parentSha,
        parentRow,
        parentLane,
        color: pi === 0 ? color : parentColor,
        type: connType,
      })

      // Mark the parent's lane as active — the line passes through intermediary rows
      if (parentRow > row + 1) {
        while (activeLanes.length <= parentLane) activeLanes.push(null)
        activeLanes[parentLane] = parentSha
      } else if (parentRow === row + 1 && parentLane >= activeLanes.length) {
        // Parent is the very next row but on a fresh rightmost lane — extend
        // activeLanes so subsequent findFreeLane calls see this column as
        // occupied (the parent will free it when reached).
        while (activeLanes.length <= parentLane) activeLanes.push(null)
        activeLanes[parentLane] = parentSha
      }
    })

    nodes.push({ commit, lane, color, row, parentConnections })
  }

  return nodes
}
