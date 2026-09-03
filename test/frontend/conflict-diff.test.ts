import { describe, it, expect } from 'vitest'
import {
  diffBlock, wordRanges, markRanges, classifyResolved, blockText, findNearest,
} from '../../src/renderer/lib/conflictDiff'
import type { ConflictFile } from '../../src/preload/index'

describe('wordRanges', () => {
  it('marks only the changed tokens on each side', () => {
    const r = wordRanges('  retries: 3,', '  retries: 5,')
    expect(r.a).toEqual([[11, 12]])
    expect(r.b).toEqual([[11, 12]])
  })
  it('merges adjacent changed tokens into one range', () => {
    const r = wordRanges('return `Hello, ${name}!`', 'return `Hi ${name}, welcome back`')
    // "Hello," → one range covering "Hello,"; the other side has "Hi" and ", welcome back"
    expect(r.a.length).toBeGreaterThanOrEqual(1)
    expect(r.a[0][0]).toBe(8)
    expect(r.b.some(([s, e]) => 'Hi ${name}, welcome back'.slice(0, 2) === 'Hi' && s === 8 && e >= 10)).toBe(true)
  })
  it('treats whitespace as its own token so indentation changes show', () => {
    const r = wordRanges('  x = 1', '    x = 1')
    expect(r.a).toEqual([[0, 2]])
    expect(r.b).toEqual([[0, 4]])
  })
  it('returns nothing for identical lines', () => {
    expect(wordRanges('same', 'same')).toEqual({ a: [], b: [] })
  })
})

describe('diffBlock', () => {
  it('flags lines shared by both sides as same and pairs the rest for word diff', () => {
    const d = diffBlock(
      ['const a = 1', 'const b = 2', 'shared()'],
      ['const a = 10', 'shared()', 'extra()'],
    )
    expect(d.current.map((l) => l.same)).toEqual([false, false, true])
    expect(d.incoming.map((l) => l.same)).toEqual([false, true, false])
    // "const a = 1" ↔ "const a = 10" are paired → word ranges present
    expect(d.current[0].ranges).toEqual([[10, 11]])
    expect(d.incoming[0].ranges).toEqual([[10, 12]])
    // "const b = 2" had no partner → no ranges (whole line is the change)
    expect(d.current[1].ranges).toBeUndefined()
  })
  it('skips word ranges when paired lines share almost nothing', () => {
    const d = diffBlock(['alpha beta gamma'], ['one two three'])
    expect(d.current[0].ranges).toBeUndefined()
    expect(d.incoming[0].ranges).toBeUndefined()
  })
  it('handles an empty side (deletion conflict)', () => {
    const d = diffBlock([''], ['kept line'])
    expect(d.current).toHaveLength(1)
    expect(d.incoming[0].same).toBe(false)
  })
})

describe('markRanges', () => {
  it('wraps a range inside plain text', () => {
    expect(markRanges('retries: 3,', [[9, 10]])).toBe('retries: <mark class="ce-mark">3</mark>,')
  })
  it('counts HTML entities as one character', () => {
    // text: a < b   html: a &lt; b   → mark "<" (offset 2..3)
    expect(markRanges('a &lt; b', [[2, 3]])).toBe('a <mark class="ce-mark">&lt;</mark> b')
  })
  it('closes and reopens the mark around tags so nesting stays valid', () => {
    const html = '<span class="hljs-keyword">const</span> a = <span class="hljs-number">10</span>'
    // text: "const a = 10" — mark "a = 10" (6..12) spanning into the number span
    const out = markRanges(html, [[6, 12]])
    expect(out).toBe(
      '<span class="hljs-keyword">const</span> <mark class="ce-mark">a = </mark><span class="hljs-number"><mark class="ce-mark">10</mark></span>',
    )
    // never a </span> while a mark is open
    expect(out).not.toMatch(/<mark[^>]*>[^<]*<\/span>/)
  })
  it('ignores empty or out-of-range ranges', () => {
    expect(markRanges('abc', [[2, 2]])).toBe('abc')
    expect(markRanges('abc', [[5, 9]])).toBe('abc')
  })
})

const file: ConflictFile = {
  path: 'x.ts',
  sections: [
    { kind: 'shared', text: 'top\nshared' },
    { kind: 'conflict', current: 'ours 1\nsame in both', incoming: 'theirs 1\nsame in both', currentLabel: 'HEAD', incomingLabel: 'topic' },
    { kind: 'shared', text: 'bottom' },
  ],
}

describe('classifyResolved', () => {
  it('labels every line by origin', () => {
    const lines = ['top', 'ours 1', 'theirs 1', 'same in both', 'typed by hand', '', '<<<<<<< HEAD', 'bottom']
    expect(classifyResolved(lines, file)).toEqual([
      'shared', 'current', 'incoming', 'both', 'edited', 'blank', 'marker', 'shared',
    ])
  })
  it('prefers shared for lines that also occur in unchanged text (boilerplate)', () => {
    const f: ConflictFile = { path: 'x', sections: [
      { kind: 'shared', text: 'a {\n}' },
      { kind: 'conflict', current: '  x\n}', incoming: '  y\n}', currentLabel: 'c', incomingLabel: 'i' },
    ] }
    expect(classifyResolved(['a {', '}', '  y', '}'], f)).toEqual(['shared', 'shared', 'incoming', 'shared'])
  })
  it('returns blank for everything when no file is loaded', () => {
    expect(classifyResolved(['a', 'b'], null)).toEqual(['blank', 'blank'])
  })
})

describe('blockText / findNearest', () => {
  const block = { current: 'A\nB', incoming: 'C' }
  it('joins both sides current-first and drops an empty side', () => {
    expect(blockText(block, 'both')).toBe('A\nB\nC')
    expect(blockText({ current: '', incoming: 'C' }, 'both')).toBe('C')
    expect(blockText({ current: 'A', incoming: '' }, 'both')).toBe('A')
  })
  it('picks the occurrence closest to the expected offset', () => {
    const hay = 'x\nfoo\nbar\nfoo\nbaz'
    expect(findNearest(hay, 'foo', 0)).toBe(2)
    expect(findNearest(hay, 'foo', 12)).toBe(10)
    expect(findNearest(hay, 'nope', 0)).toBe(-1)
    expect(findNearest(hay, '', 0)).toBe(-1)
  })
})
