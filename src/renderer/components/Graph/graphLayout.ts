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

const LANE_COLORS = [
  '#63b3ed', // sky blue
  '#68d391', // green
  '#f6ad55', // amber
  '#fc8181', // coral
  '#b794f4', // purple
  '#76e4f7', // cyan
  '#fbb6ce', // pink
  '#f6e05e', // yellow
  '#9f7aea', // indigo
  '#4fd1c5', // teal
]

export function getLaneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length]
}

export function buildGraphLayout(commits: CommitNode[]): GraphNode[] {
  const nodes: GraphNode[] = []
  const shaToRow = new Map<string, number>()
  const shaToLane = new Map<string, number>()
  const shaToColor = new Map<string, string>()

  // Build sha → row index
  commits.forEach((c, i) => shaToRow.set(c.sha, i))

  // Track which lanes are "occupied" at each row
  // activeLanes[lane] = sha of commit whose line is currently running through it
  const activeLanes: (string | null)[] = []

  const findFreeLane = (exclude: Set<number> = new Set()): number => {
    for (let i = 0; i < activeLanes.length; i++) {
      if (!exclude.has(i) && activeLanes[i] === null) return i
    }
    return activeLanes.length
  }

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row]
    const { sha, parents } = commit

    // Determine this commit's lane
    let lane: number
    if (shaToLane.has(sha)) {
      lane = shaToLane.get(sha)!
    } else {
      lane = findFreeLane()
    }

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
        parentLane = shaToLane.get(parentSha)!
      } else if (pi === 0) {
        // First parent continues in same lane
        parentLane = lane
        shaToLane.set(parentSha, parentLane)
        shaToColor.set(parentSha, color)
      } else {
        // Merge parent gets a new lane
        parentLane = findFreeLane(usedLanes)
        shaToLane.set(parentSha, parentLane)
        shaToColor.set(parentSha, getLaneColor(parentLane))
      }

      usedLanes.add(parentLane)

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
      }
    })

    nodes.push({ commit, lane, color, row, parentConnections })
  }

  return nodes
}
