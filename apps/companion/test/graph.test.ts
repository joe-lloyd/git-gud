import { describe, it, expect } from 'vitest'
import { assignLanes, ago } from '../src/net/lanes'
import { tokenize, languageFor, classifyDiffLine } from '../src/ui/highlight'

const row = (sha: string, parents: string[], message = sha) => ({ sha, parents, message })

describe('assignLanes connectivity', () => {
  it('a linear history is one lane with every node connected top and bottom', () => {
    const rows = assignLanes([row('c', ['b']), row('b', ['a']), row('a', [])])
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0])
    expect(rows.map((r) => r.fromTop)).toEqual([false, true, true])
    expect(rows.map((r) => r.toBottom)).toEqual([true, true, false])
    expect(rows.every((r) => r.through.length === 0 && r.joins.length === 0 && r.forks.length === 0)).toBe(true)
  })
  it('a merge forks to the second parent lane, which passes through until it joins', () => {
    // m merges f into main: m(main, f) ; main ; f ; base
    const rows = assignLanes([row('m', ['main', 'f']), row('main', ['base']), row('f', ['base']), row('base', [])])
    const [m, main, f, base] = rows
    expect(m.lane).toBe(0); expect(m.forks).toEqual([1])
    expect(main.lane).toBe(0); expect(main.through).toEqual([1]) // f's lane passes by
    expect(f.lane).toBe(1); expect(f.fromTop).toBe(true)
    expect(base.lane).toBe(0); expect(base.joins).toEqual([1]) // f's lane ends at base
    expect(base.lanes).toBeGreaterThanOrEqual(2)
  })
  it('every line has a continuation: a lane in `through` on row i is expected again on row i+1', () => {
    const rows = assignLanes([row('m', ['a', 'b']), row('a', ['c']), row('b', ['c']), row('c', ['d']), row('d', [])])
    for (let i = 0; i < rows.length - 1; i++) for (const l of rows[i].through) {
      const next = rows[i + 1]
      expect(next.through.includes(l) || next.lane === l || next.joins.includes(l)).toBe(true)
    }
  })
})

describe('ago', () => {
  it('formats relative times compactly and accepts seconds or ms', () => {
    const now = 1_700_000_000_000
    expect(ago(now - 30_000, now)).toBe('now'); expect(ago(now - 5 * 60_000, now)).toBe('5m'); expect(ago(now - 3 * 3_600_000, now)).toBe('3h')
    expect(ago(1_700_000_000 - 86400 * 2, now)).toBe('2d') // git %ct seconds
  })
})

describe('highlight', () => {
  it('maps extensions to languages', () => {
    expect(languageFor('src/a.tsx')).toBe('js'); expect(languageFor('Dockerfile')).toBe('sh'); expect(languageFor('x.unknownext')).toBeNull(); expect(languageFor('build.gradle')).toBe('gradle')
  })
  it('tokenizes keywords, strings, comments and numbers', () => {
    const t = tokenize("const x = foo('bar', 42) // hi", 'js')
    expect(t.find((k) => k.text === 'const')?.kind).toBe('keyword')
    expect(t.find((k) => k.text === "'bar'")?.kind).toBe('string')
    expect(t.find((k) => k.text === '42')?.kind).toBe('number')
    expect(t[t.length - 1]).toEqual({ text: '// hi', kind: 'comment' })
    expect(t.map((k) => k.text).join('')).toBe("const x = foo('bar', 42) // hi")
  })
  it('python uses # comments and keeps text intact', () => {
    const src = 'def f(x):  # doc'
    const t = tokenize(src, 'py')
    expect(t[0]).toEqual({ text: 'def', kind: 'keyword' }); expect(t[t.length - 1].kind).toBe('comment')
    expect(t.map((k) => k.text).join('')).toBe(src)
  })
  it('classifies diff lines', () => {
    expect(classifyDiffLine('+foo')).toEqual({ kind: 'add', marker: '+', code: 'foo' })
    expect(classifyDiffLine('-bar').kind).toBe('del'); expect(classifyDiffLine('@@ -1 +1 @@').kind).toBe('hunk'); expect(classifyDiffLine('+++ b/x').kind).toBe('meta'); expect(classifyDiffLine(' ctx').code).toBe('ctx')
  })
})
