import React from 'react'
import Svg, { Circle, Line } from 'react-native-svg'
import { LANE_COLORS } from '../net/lanes'

// One row of the simplified graph: vertical lines for active lanes, a dot on
// this commit's lane, diagonals to the lanes of extra parents (merges).
export const LaneGlyph: React.FC<{ lane: number; lanes: number; parents: number[]; color: string }> = ({ lane, lanes, parents, color }) => {
  const W = 14, H = 34, n = Math.max(lanes, 1)
  const x = (l: number) => 7 + l * W
  return (
    <Svg width={x(n - 1) + 8} height={H}>
      {Array.from({ length: n }, (_, l) => <Line key={l} x1={x(l)} y1={0} x2={x(l)} y2={H} stroke={LANE_COLORS[l % LANE_COLORS.length]} strokeOpacity={0.45} strokeWidth={2} />)}
      {parents.slice(1).map((pl) => <Line key={pl} x1={x(lane)} y1={H / 2} x2={x(pl)} y2={H} stroke={LANE_COLORS[pl % LANE_COLORS.length]} strokeWidth={2} />)}
      <Circle cx={x(lane)} cy={H / 2} r={4.5} fill={color} />
    </Svg>
  )
}
