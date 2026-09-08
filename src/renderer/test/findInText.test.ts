import { describe, it, expect } from 'vitest'
import { findInLines, matchesByLine, cycle, clipRanges, markHtmlMatches } from '../lib/findInText'

describe('findInLines', () => {
  it('finds case-insensitive literal hits in document order, never across lines', () => {
    const lines = ['const Foo = foo()', 'bar', 'FOO']
    expect(findInLines(lines, 'foo')).toEqual([
      { line: 0, start: 6, end: 9 },
      { line: 0, start: 12, end: 15 },
      { line: 2, start: 0, end: 3 },
    ])
  })

  it('returns nothing for an empty query and skips blank lines', () => {
    expect(findInLines(['a', ''], '')).toEqual([])
    expect(findInLines(['', 'aa'], 'a')).toEqual([{ line: 1, start: 0, end: 1 }, { line: 1, start: 1, end: 2 }])
  })

  it('does not report overlapping hits', () => {
    expect(findInLines(['aaaa'], 'aa')).toEqual([{ line: 0, start: 0, end: 2 }, { line: 0, start: 2, end: 4 }])
  })

  it('treats the query literally, not as a regex', () => {
    expect(findInLines(['a.b axb'], 'a.b')).toEqual([{ line: 0, start: 0, end: 3 }])
    expect(findInLines(['x(y)'], '(y)')).toEqual([{ line: 0, start: 1, end: 4 }])
  })
})

describe('matchesByLine / cycle / clipRanges', () => {
  it('groups ranges per line', () => {
    const m = matchesByLine([{ line: 2, start: 1, end: 2 }, { line: 2, start: 5, end: 6 }, { line: 0, start: 0, end: 1 }])
    expect(m.get(2)).toEqual([[1, 2], [5, 6]])
    expect(m.get(0)).toEqual([[0, 1]])
    expect(m.get(1)).toBeUndefined()
  })

  it('wraps in both directions and tolerates an empty list', () => {
    expect(cycle(3, 3)).toBe(0)
    expect(cycle(-1, 3)).toBe(2)
    expect(cycle(5, 0)).toBe(0)
  })

  it('clips and re-bases ranges to a fragment window', () => {
    // Line "hello world", fragment "world" starts at 6; hit "o w" = [4,7).
    expect(clipRanges([[4, 7]], 6, 5)).toEqual([[0, 1]])
    expect(clipRanges([[4, 7]], 0, 5)).toEqual([[4, 5]])
    expect(clipRanges([[8, 9]], 0, 5)).toEqual([])
  })
})

describe('markHtmlMatches', () => {
  it('marks hits without breaking existing tags and flags the active one', () => {
    const html = '<span class="hljs-keyword">const</span> foo = <span class="hljs-string">"foo"</span>'
    const out = markHtmlMatches(html, [[6, 9], [13, 16]], [13, 16])
    expect(out).toBe(
      '<span class="hljs-keyword">const</span> <mark class="find-mark">foo</mark> = ' +
      '<span class="hljs-string">"<mark class="find-mark find-mark-active">foo</mark>"</span>',
    )
  })

  it('leaves the html untouched when there are no ranges', () => {
    expect(markHtmlMatches('a &lt; b', [], null)).toBe('a &lt; b')
  })

  it('counts an HTML entity as one text character', () => {
    // Text is `a < b`; hit on "< b" = [2,5).
    expect(markHtmlMatches('a &lt; b', [[2, 5]], null)).toBe('a <mark class="find-mark">&lt; b</mark>')
  })
})
