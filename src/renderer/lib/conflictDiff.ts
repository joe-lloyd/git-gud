// Pure helpers behind the conflict editor's "what actually changed" views.
//
//   diffBlock          — line-level LCS between the two sides of one conflict
//                        block, plus word-level change ranges for lines that
//                        were modified rather than added/removed outright.
//   markRanges         — wrap character ranges of a highlight.js HTML fragment
//                        in <mark> spans without breaking its tag nesting.
//   classifyResolved   — for every line of the resolved buffer, say where it
//                        came from (shared / current / incoming / both / edited)
//                        so the result pane can paint an origin gutter.
//
// Everything here is synchronous and allocation-light: the editor recomputes
// on every keystroke in the resolved pane.

import type { ConflictFile } from '../../preload/index'

export type Range = [start: number, end: number] // half-open, in characters

export interface BlockLine {
  text: string
  /** True when this line also appears (in LCS order) on the other side. */
  same: boolean
  /** Character ranges that differ from the paired line on the other side.
   *  Only set for lines that were modified (paired), never for pure adds. */
  ranges?: Range[]
}

export interface BlockDiff {
  current: BlockLine[]
  incoming: BlockLine[]
}

// ── LCS ─────────────────────────────────────────────────────────────────────

// Classic O(n·m) LCS table; returns, for each side, whether the element is
// part of the common subsequence. Inputs are tiny (one conflict block or one
// line's tokens) so the quadratic table is fine. Guarded by MAX_CELLS so a
// pathological block degrades to "everything differs" instead of freezing.
const MAX_CELLS = 250_000

function lcsFlags<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): { a: boolean[]; b: boolean[] } {
  const n = a.length, m = b.length
  const fa = new Array<boolean>(n).fill(false)
  const fb = new Array<boolean>(m).fill(false)
  if (n === 0 || m === 0 || n * m > MAX_CELLS) return { a: fa, b: fb }
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const w = m + 1
  const dp = new Uint32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = eq(a[i], b[j])
        ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }
  let i = 0, j = 0
  while (i < n && j < m) {
    if (eq(a[i], b[j])) { fa[i] = true; fb[j] = true; i++; j++ }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++
    else j++
  }
  return { a: fa, b: fb }
}

// ── Word diff ───────────────────────────────────────────────────────────────

// Tokens: runs of word chars, runs of whitespace, or a single other char.
// Keeping whitespace as its own token means an indentation change lights up
// as a change instead of silently shifting every following token.
const TOKEN_RE = /\w+|\s+|[^\w\s]/g

function tokenize(s: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = []
  for (const m of s.matchAll(TOKEN_RE)) out.push({ text: m[0], start: m.index ?? 0 })
  return out
}

/** Character ranges on each side that are not part of the common token
 *  subsequence. Adjacent ranges are merged so a run of changed tokens becomes
 *  one highlight. */
export function wordRanges(a: string, b: string): { a: Range[]; b: Range[] } {
  const ta = tokenize(a), tb = tokenize(b)
  const flags = lcsFlags(ta, tb, (x, y) => x.text === y.text)
  const collect = (toks: { text: string; start: number }[], f: boolean[]): Range[] => {
    const ranges: Range[] = []
    for (let i = 0; i < toks.length; i++) {
      if (f[i]) continue
      const s = toks[i].start, e = s + toks[i].text.length
      const last = ranges[ranges.length - 1]
      if (last && last[1] === s) last[1] = e
      else ranges.push([s, e])
    }
    return ranges
  }
  return { a: collect(ta, flags.a), b: collect(tb, flags.b) }
}

// ── Block diff ──────────────────────────────────────────────────────────────

/**
 * Compare the two sides of a conflict block. Lines in the LCS are `same`;
 * within each gap between common lines, the leftover lines are paired up
 * positionally (first removed with first added, …) and word-diffed, so a
 * one-token edit shows as a highlighted token instead of a whole red/green
 * line pair.
 */
export function diffBlock(current: string[], incoming: string[]): BlockDiff {
  const flags = lcsFlags(current, incoming, (x, y) => x === y)
  const cur: BlockLine[] = current.map((text, i) => ({ text, same: flags.a[i] }))
  const inc: BlockLine[] = incoming.map((text, i) => ({ text, same: flags.b[i] }))

  // Walk both sides in lockstep, collecting the gap before each common line.
  let i = 0, j = 0
  const pairGap = (ci: number[], ij: number[]) => {
    const n = Math.min(ci.length, ij.length)
    for (let k = 0; k < n; k++) {
      const a = cur[ci[k]], b = inc[ij[k]]
      // Skip word diff when the lines share nothing — the whole line is the
      // change, and a token-level highlight would just be noise.
      const r = wordRanges(a.text, b.text)
      const changedA = r.a.reduce((s, [x, y]) => s + (y - x), 0)
      const changedB = r.b.reduce((s, [x, y]) => s + (y - x), 0)
      const mostlyDifferent = changedA > a.text.length * 0.7 && changedB > b.text.length * 0.7
      if (!mostlyDifferent) { a.ranges = r.a; b.ranges = r.b }
    }
  }
  while (i < cur.length || j < inc.length) {
    const gapC: number[] = [], gapI: number[] = []
    while (i < cur.length && !cur[i].same) gapC.push(i++)
    while (j < inc.length && !inc[j].same) gapI.push(j++)
    pairGap(gapC, gapI)
    // Both now sit on a common line (or the end) — step over it.
    if (i < cur.length && j < inc.length) { i++; j++ }
    else break
  }
  return { current: cur, incoming: inc }
}

// ── HTML range marking ──────────────────────────────────────────────────────

const ENTITY_RE = /^&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/

/**
 * Wrap the given character ranges (offsets into the *text* the fragment
 * renders, not into the HTML) in `<mark class="cls">`. A mark that spans a
 * tag boundary is closed before the tag and reopened after it so the output
 * stays well-nested — browsers would otherwise drop the tail of the mark.
 */
export function markRanges(html: string, ranges: Range[], cls = 'ce-mark'): string {
  if (ranges.length === 0) return html
  const sorted = [...ranges].filter(([s, e]) => e > s).sort((x, y) => x[0] - y[0])
  if (sorted.length === 0) return html
  const open = `<mark class="${cls}">`, close = '</mark>'
  let out = ''
  let pos = 0         // text offset
  let ri = 0          // current range index
  let inMark = false
  let i = 0
  const enter = () => { if (!inMark) { out += open; inMark = true } }
  const leave = () => { if (inMark) { out += close; inMark = false } }
  const syncAt = () => {
    // Advance past ranges that ended; open one that starts here.
    while (ri < sorted.length && sorted[ri][1] <= pos) { ri++ }
    if (ri < sorted.length && sorted[ri][0] <= pos && pos < sorted[ri][1]) enter()
    else leave()
  }
  while (i < html.length) {
    const ch = html[i]
    if (ch === '<') {
      const end = html.indexOf('>', i)
      if (end === -1) { out += html.slice(i); break }
      // Close an open mark before the tag; syncAt() reopens it on the next
      // text character if the range continues (so no empty marks at the end).
      leave()
      out += html.slice(i, end + 1)
      i = end + 1
      continue
    }
    syncAt()
    if (ch === '&') {
      const m = ENTITY_RE.exec(html.slice(i, i + 12))
      if (m) { out += m[0]; i += m[0].length; pos++; continue }
    }
    out += ch
    i++
    pos++
  }
  leave()
  return out
}

// ── Resolved-line origin ────────────────────────────────────────────────────

export type LineOrigin = 'shared' | 'current' | 'incoming' | 'both' | 'edited' | 'marker' | 'blank'

const MARKER_RE = /^(<{7}|={7}|>{7}|\|{7})(\s|$)/

/**
 * Label each resolved line by where its text came from. Content-based on
 * purpose: the resolved buffer is free-form, so there is no positional link
 * back to the sections after the first edit. Lines that match both sides of a
 * block are `both`; lines matching nothing are `edited` (typed or pasted);
 * leftover conflict markers are `marker`. Empty lines are `blank` so they
 * never paint a gutter colour.
 */
export function classifyResolved(resolvedLines: string[], file: ConflictFile | null): LineOrigin[] {
  if (!file) return resolvedLines.map(() => 'blank')
  const shared = new Set<string>()
  const cur = new Set<string>()
  const inc = new Set<string>()
  for (const s of file.sections) {
    if (s.kind === 'shared') { for (const l of s.text.split('\n')) shared.add(l) }
    else {
      for (const l of s.current.split('\n')) cur.add(l)
      for (const l of s.incoming.split('\n')) inc.add(l)
    }
  }
  return resolvedLines.map((line) => {
    if (line.trim() === '') return 'blank'
    if (MARKER_RE.test(line)) return 'marker'
    // A line that also occurs in the unchanged text (a closing brace, a blank
    // comment) is indistinguishable from that text, so it is not painted as a
    // decision — only lines unique to a side (or to both sides) get a tag.
    if (shared.has(line)) return 'shared'
    const c = cur.has(line), n = inc.has(line)
    if (c && n) return 'both'
    if (c) return 'current'
    if (n) return 'incoming'
    return 'edited'
  })
}

/** Text of one side of a conflict block, or both concatenated. */
export function blockText(block: { current: string; incoming: string }, side: 'current' | 'incoming' | 'both'): string {
  if (side === 'current') return block.current
  if (side === 'incoming') return block.incoming
  if (block.current === '') return block.incoming
  if (block.incoming === '') return block.current
  return `${block.current}\n${block.incoming}`
}

/**
 * Locate `needle` in `haystack` near `expectedIndex`, returning the character
 * offset of the closest occurrence or -1. Used to find where a block's
 * previous choice sits in the resolved buffer so a new choice can replace it
 * in place even after the user edited surrounding text.
 */
export function findNearest(haystack: string, needle: string, expectedIndex: number): number {
  if (needle === '') return -1
  let best = -1
  let from = 0
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) break
    if (best === -1 || Math.abs(at - expectedIndex) < Math.abs(best - expectedIndex)) best = at
    from = at + 1
  }
  return best
}
