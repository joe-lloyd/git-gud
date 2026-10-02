import { describe, it, expect, vi } from 'vitest'

vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }))

import { diffRows, collapseReason } from '../src/ui/diffRows'
import { parseInline, parseMarkdown } from '../src/ui/mdParse'
import { firstUnviewed, progress, shortHash, toggle, viewedKey } from '../src/state/viewed'
import { age, botLabel } from '../src/ui/forge'

describe('diffRows', () => {
  it('numbers old/new lines per hunk and keeps "--" content lines as deletions', () => {
    const rows = diffRows([
      'diff --git a/q.sql b/q.sql',
      '--- a/q.sql',
      '+++ b/q.sql',
      '@@ -10,3 +10,3 @@ SELECT',
      ' a',
      '--- old comment',
      '+-- new comment',
      ' b',
      '\\ No newline at end of file',
    ].join('\n'))
    expect(rows).toEqual([
      { kind: 'hunk', text: '@@ SELECT' },
      { kind: 'ctx', code: 'a', oldNo: 10, newNo: 10 },
      { kind: 'del', code: '-- old comment', oldNo: 11 },
      { kind: 'add', code: '-- new comment', newNo: 11 },
      { kind: 'ctx', code: 'b', oldNo: 12, newNo: 12 },
      { kind: 'note', text: 'No newline at end of file' },
    ])
  })

  it('shows file headers only when asked (commit diffs) and handles 1-line hunks', () => {
    const p = 'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b'
    expect(diffRows(p).map((r) => r.kind)).toEqual(['hunk', 'del', 'add'])
    expect(diffRows(p, { meta: true })[0]).toEqual({ kind: 'meta', text: 'diff --git a/x b/x' })
  })

  it('collapses lockfiles, binaries and very large patches', () => {
    expect(collapseReason({ path: 'apps/x/pnpm-lock.yaml', binary: false, lines: 10 })).toBe('generated')
    expect(collapseReason({ path: 'logo.png', binary: true, lines: 0 })).toBe('binary')
    expect(collapseReason({ path: 'src/big.ts', binary: false, lines: 5000 })).toBe('large')
    expect(collapseReason({ path: 'src/small.ts', binary: false, lines: 50 })).toBeNull()
  })
})

describe('markdown subset', () => {
  it('parses headings, lists, tasks, code fences, tables; drops HTML comments and details tags', () => {
    const b = parseMarkdown([
      '<!-- jev-base-review -->',
      '## Summary',
      'Adds the **forge** layer, see [docs](https://x/y).',
      '',
      '- one',
      '  - nested `code`',
      '- [x] done',
      '1. first',
      '```ts',
      'const a = 1',
      '```',
      '| Check | Choice |',
      '|---|---:|',
      '| scope | ok |',
      '<details><summary>All</summary>',
      'hidden text',
      '</details>',
    ].join('\n'))
    expect(b.map((x) => x.kind)).toEqual(['heading', 'para', 'item', 'item', 'item', 'item', 'code', 'table', 'para', 'para'])
    expect(b[3]).toMatchObject({ depth: 1, marker: '•' })
    expect(b[4]).toMatchObject({ marker: '☑' })
    expect(b[5]).toMatchObject({ ordered: true, marker: '1.' })
    expect(b[6]).toEqual({ kind: 'code', lang: 'ts', text: 'const a = 1' })
    expect((b[7] as { text: string }).text).toBe('Check  │  Choice\nscope  │  ok')
  })

  it('inline: code, bold, italic, links, bare urls; snake_case stays plain', () => {
    expect(parseInline('a `b` **c** *d* [e](https://f) https://g.h my_var_name __init__')).toEqual([
      { text: 'a ' }, { text: 'b', code: true }, { text: ' ' }, { text: 'c', bold: true }, { text: ' ' }, { text: 'd', italic: true },
      { text: ' ' }, { text: 'e', href: 'https://f' }, { text: ' ' }, { text: 'https://g.h', href: 'https://g.h' }, { text: ' my_var_name __init__' },
    ])
  })
})

describe('viewed state', () => {
  const files = [{ patchHash: 'aaaaaaaaaaaaXXXX' }, { patchHash: 'bbbbbbbbbbbbXXXX' }, { patchHash: 'ccccccccccccXXXX' }]
  it('ticks by patch hash, survives a push for unchanged files, drops files that left the PR', () => {
    let v = toggle(null, 'h1', files, files[0].patchHash, true)
    v = toggle(v, 'h1', files, files[1].patchHash, true)
    expect(progress(files, v)).toEqual({ viewed: 2, total: 3 })
    expect(firstUnviewed(files, v)).toBe(2)
    // push: file b changed, a and c did not
    const after = [files[0], { patchHash: 'dddddddddddd0000' }, files[2]]
    expect(progress(after, v)).toEqual({ viewed: 1, total: 3 })
    expect(firstUnviewed(after, v)).toBe(1)
    v = toggle(v, 'h2', after, after[2].patchHash, true)
    expect(v).toEqual({ head: 'h2', hashes: [shortHash(files[0].patchHash), shortHash(files[2].patchHash)] })
    expect(toggle(v, 'h2', after, files[0].patchHash, false).hashes).toEqual([shortHash(files[2].patchHash)])
  })
  it('keys are SecureStore-safe and distinct per PR', () => {
    const k = viewedKey('home', 'joe-lloyd/git-gud', 212)
    expect(k).toMatch(/^[A-Za-z0-9._-]+$/)
    expect(k).not.toBe(viewedKey('home', 'joe-lloyd/git-gud', 213))
    expect(k).not.toBe(viewedKey('home', 'joe-lloyd/other', 212))
  })
})

describe('labels', () => {
  it('age and bot labels', () => {
    const now = Date.parse('2026-10-02T12:00:00Z')
    expect(age('2026-10-02T11:59:30Z', now)).toBe('now')
    expect(age('2026-10-02T10:00:00Z', now)).toBe('2h')
    expect(age('2026-09-29T12:00:00Z', now)).toBe('3d')
    expect(botLabel({ name: 'JEV', state: 'warning', description: '' })).toBe('JEV ⚠ changes')
    expect(botLabel({ name: 'JEV', state: 'success', description: '' })).toBe('JEV ✓ merge')
  })
})

describe('v1.20.1 fixes', () => {
  it('JEV failure reads as changes required, error as a failed run', async () => {
    const { botLabel } = await import('../src/ui/forge')
    expect(botLabel({ name: 'JEV', state: 'failure', description: '' })).toBe('JEV ✗ changes')
    expect(botLabel({ name: 'JEV', state: 'error', description: '' })).toBe('JEV failed')
  })
  it('extension labels', async () => {
    const { extLabel } = await import('../src/ui/forge')
    expect(extLabel('packages/core/src/decide.ts')).toBe('ts')
    expect(extLabel('Dockerfile')).toBe('Dockerfile')
    expect(extLabel('.env')).toBe('.env')
  })
  it('html: apostrophes in prose stay plain, attribute values are strings', async () => {
    const { tokenize } = await import('../src/ui/highlight')
    const toks = tokenize(`<p class="x">an idea's chat, a task's chat</p>`, 'html')
    expect(toks.filter((t) => t.kind === 'string').map((t) => t.text)).toEqual(['"x"'])
    expect(toks.map((t) => t.text).join('')).toBe(`<p class="x">an idea's chat, a task's chat</p>`)
    const md = tokenize(`it's "quoted"`, 'md')
    expect(md.some((t) => t.kind === 'string')).toBe(false)
  })
  it('code still highlights strings', async () => {
    const { tokenize } = await import('../src/ui/highlight')
    expect(tokenize(`const a = 'x'`, 'js').some((t) => t.kind === 'string' && t.text === "'x'")).toBe(true)
  })
})
