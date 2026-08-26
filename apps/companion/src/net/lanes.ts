// Simplified commit-graph lanes for a phone screen: one lane per first-parent
// chain, colour by lane. Input is what GitService.getLog returns (sha,
// parents, refs); output is per-row lane index + connections to draw.
export interface LogRow { sha: string; parents: string[]; refs?: string[]; message: string; author?: string; date?: string | number }
export interface LaneRow { sha: string; lane: number; lanes: number; parentsLanes: number[]; row: LogRow }

export function assignLanes(rows: LogRow[]): LaneRow[] {
  const active: (string | null)[] = [] // lane → sha expected next
  const out: LaneRow[] = []
  for (const r of rows) {
    let lane = active.indexOf(r.sha)
    if (lane < 0) { lane = active.indexOf(null); if (lane < 0) { lane = active.length; active.push(null) } }
    // this commit occupies `lane`; first parent continues the lane
    const [p0, ...rest] = r.parents
    active[lane] = p0 ?? null
    const parentsLanes = [lane]
    for (const p of rest) {
      let pl = active.indexOf(p)
      if (pl < 0) { pl = active.indexOf(null); if (pl < 0) { pl = active.length; active.push(null) } active[pl] = p }
      parentsLanes.push(pl)
    }
    // other lanes already waiting for the same sha merge into this one
    for (let i = 0; i < active.length; i++) if (i !== lane && active[i] === r.sha) active[i] = null
    while (active.length && active[active.length - 1] === null) active.pop()
    out.push({ sha: r.sha, lane, lanes: Math.max(active.length, lane + 1), parentsLanes, row: r })
  }
  return out
}

export const LANE_COLORS = ['#ff79c6', '#8be9fd', '#50fa7b', '#f1fa8c', '#bd93f9', '#ffb86c', '#ff5555']
