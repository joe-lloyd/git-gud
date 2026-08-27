// Commit-graph lanes for a phone screen. Input is what GitService.getLog
// returns (sha, parents, refs …); output is, per row, everything the glyph
// needs to draw lines that *connect* to the rows above and below:
//   lane        – column of this commit's node
//   through     – lanes whose line passes straight through this row
//   fromTop     – a line arrives at the node from the row above (a child expects this sha)
//   toBottom    – the node continues down (first parent exists)
//   joins       – other lanes ending at this node (they also expected this sha): curve top → node
//   forks       – lanes of extra parents (merge): curve node → bottom at that lane
//   lanes       – lane count to size the glyph
export interface LogRow { sha: string; parents: string[]; refs?: string[]; message: string; author?: string; date?: string | number; timestamp?: number }
export interface LaneRow {
  sha: string; lane: number; lanes: number
  through: number[]; fromTop: boolean; toBottom: boolean; joins: number[]; forks: number[]
  row: LogRow
}

export function assignLanes(rows: LogRow[]): LaneRow[] {
  const active: (string | null)[] = [] // lane → sha expected next (null = free)
  const out: LaneRow[] = []
  for (const r of rows) {
    const before = active.slice()
    let lane = active.indexOf(r.sha)
    const fromTop = lane >= 0
    if (lane < 0) { lane = active.indexOf(null); if (lane < 0) { lane = active.length; active.push(null) } }
    // Other lanes that were waiting for this sha merge into this node.
    const joins: number[] = []
    for (let i = 0; i < active.length; i++) if (i !== lane && active[i] === r.sha) { joins.push(i); active[i] = null }
    // This commit occupies `lane`; its first parent continues the lane.
    const [p0, ...rest] = r.parents
    active[lane] = p0 ?? null
    const forks: number[] = []
    for (const p of rest) {
      let pl = active.indexOf(p)
      if (pl < 0) { pl = active.indexOf(null); if (pl < 0) { pl = active.length; active.push(null) } active[pl] = p }
      if (pl !== lane) forks.push(pl)
    }
    // Lines passing through: lanes busy both before and after this row, other than ours.
    const through: number[] = []
    for (let i = 0; i < Math.max(before.length, active.length); i++) if (i !== lane && before[i] && active[i] && before[i] === active[i]) through.push(i)
    const lanes = Math.max(before.length, active.length, lane + 1, ...forks.map((f) => f + 1), ...joins.map((j) => j + 1))
    while (active.length && active[active.length - 1] === null) active.pop()
    out.push({ sha: r.sha, lane, lanes, through, fromTop, toBottom: p0 !== undefined, joins, forks, row: r })
  }
  return out
}

export const LANE_COLORS = ['#ff79c6', '#8be9fd', '#50fa7b', '#f1fa8c', '#bd93f9', '#ffb86c', '#ff5555']
export const laneColor = (lane: number): string => LANE_COLORS[lane % LANE_COLORS.length]

export function ago(d: string | number | undefined, now = Date.now()): string {
  if (d === undefined) return ''
  const t = typeof d === 'number' ? (d < 1e12 ? d * 1000 : d) : Date.parse(d)
  if (!Number.isFinite(t)) return String(d)
  const s = Math.max(0, (now - t) / 1000)
  if (s < 60) return 'now'; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`; if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo`; return `${Math.floor(s / (86400 * 365))}y`
}
