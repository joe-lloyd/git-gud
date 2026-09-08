import { markRanges, type Range } from './conflictDiff'

/**
 * One hit of an in-file find: which line it is on and the character span
 * inside that line. `line` indexes whatever line list the caller searched.
 */
export interface TextMatch {
  line: number
  start: number
  end: number
}

/**
 * Case-insensitive literal search over a list of lines. Matches never cross a
 * line boundary and never overlap (the scan resumes after each hit), so the
 * result is already in document order and safe to feed to `markRanges`.
 */
export function findInLines(lines: readonly string[], query: string): TextMatch[] {
  if (query === '') return []
  const q = query.toLowerCase()
  const out: TextMatch[] = []
  for (let i = 0; i < lines.length; i++) {
    const hay = lines[i].toLowerCase()
    let from = 0
    while (from <= hay.length - q.length) {
      const at = hay.indexOf(q, from)
      if (at === -1) break
      out.push({ line: i, start: at, end: at + q.length })
      from = at + q.length
    }
  }
  return out
}

/**
 * Group matches by line so a renderer can look up "what do I mark on row N"
 * in O(1) instead of filtering the whole list per row.
 */
export function matchesByLine(matches: readonly TextMatch[]): Map<number, Range[]> {
  const m = new Map<number, Range[]>()
  for (const t of matches) {
    const arr = m.get(t.line)
    if (arr) arr.push([t.start, t.end])
    else m.set(t.line, [[t.start, t.end]])
  }
  return m
}

/** Wrap an index into [0, n) — used for Enter / Shift+Enter cycling. */
export function cycle(i: number, n: number): number {
  if (n <= 0) return 0
  return ((i % n) + n) % n
}

/**
 * Restrict line-space ranges to the window [off, off+len) and re-base them to
 * that window. Used when one logical line is rendered as several adjacent
 * fragments (word-diff runs) that each need their own marks.
 */
export function clipRanges(ranges: readonly Range[], off: number, len: number): Range[] {
  const out: Range[] = []
  for (const [s, e] of ranges) {
    const cs = Math.max(s, off), ce = Math.min(e, off + len)
    if (ce > cs) out.push([cs - off, ce - off])
  }
  return out
}

/**
 * Mark every find hit on an already syntax-highlighted line. The active hit
 * gets an extra class so the user can see which one Enter will step from.
 * Runs `markRanges` twice because it only takes a single class per call; the
 * second pass re-walks HTML that already contains marks, which it handles
 * (a mark is closed before any tag and reopened after it).
 */
export function markHtmlMatches(html: string, ranges: readonly Range[], active: Range | null): string {
  const isActive = (r: Range) => active !== null && r[0] === active[0] && r[1] === active[1]
  const rest = ranges.filter((r) => !isActive(r))
  let out = markRanges(html, rest, 'find-mark')
  if (active && ranges.some(isActive)) out = markRanges(out, [active], 'find-mark find-mark-active')
  return out
}
