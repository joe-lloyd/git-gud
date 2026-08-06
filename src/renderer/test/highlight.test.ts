import { describe, it, expect } from 'vitest'
import { resolveLanguage, highlightLines } from '../lib/highlight'

describe('resolveLanguage', () => {
  it('maps known extensions to their language id', () => {
    expect(resolveLanguage('src/foo/bar.tsx')).toBe('typescript')
    expect(resolveLanguage('a.ts')).toBe('typescript')
    expect(resolveLanguage('a.jsx')).toBe('javascript')
    expect(resolveLanguage('a.js')).toBe('javascript')
    expect(resolveLanguage('a.json')).toBe('json')
    expect(resolveLanguage('a.sh')).toBe('bash')
    expect(resolveLanguage('a.css')).toBe('css')
    expect(resolveLanguage('a.scss')).toBe('scss')
    expect(resolveLanguage('a.sass')).toBe('scss')
    expect(resolveLanguage('main.go')).toBe('go')
  })

  it('is case-insensitive', () => {
    expect(resolveLanguage('Main.GO')).toBe('go')
    expect(resolveLanguage('App.TSX')).toBe('typescript')
  })

  it('resolves .env (dotfile) as bash', () => {
    expect(resolveLanguage('.env')).toBe('bash')
    expect(resolveLanguage('app/.env')).toBe('bash')
  })

  it('maps doc and config types', () => {
    expect(resolveLanguage('README.md')).toBe('markdown')
    expect(resolveLanguage('docs/guide.markdown')).toBe('markdown')
    expect(resolveLanguage('ci.yml')).toBe('yaml')
    expect(resolveLanguage('index.html')).toBe('xml')
    expect(resolveLanguage('logo.svg')).toBe('xml')
    expect(resolveLanguage('Cargo.toml')).toBe('ini')
    expect(resolveLanguage('.editorconfig')).toBe('ini')
  })

  it('maps extensionless well-known files by bare name', () => {
    expect(resolveLanguage('Makefile')).toBe('makefile')
    expect(resolveLanguage('services/api/Dockerfile')).toBe('dockerfile')
    expect(resolveLanguage('Gemfile')).toBe('ruby')
  })

  it('maps common language extensions', () => {
    expect(resolveLanguage('main.py')).toBe('python')
    expect(resolveLanguage('lib.rs')).toBe('rust')
    expect(resolveLanguage('a.c')).toBe('c')
    expect(resolveLanguage('a.hpp')).toBe('cpp')
    expect(resolveLanguage('App.java')).toBe('java')
    expect(resolveLanguage('Main.kt')).toBe('kotlin')
    expect(resolveLanguage('schema.sql')).toBe('sql')
  })

  it('returns null for .txt and noisy-if-highlighted files', () => {
    expect(resolveLanguage('notes.txt')).toBeNull()
    expect(resolveLanguage('.gitignore')).toBeNull()
    expect(resolveLanguage('pnpm-lock.lock')).toBeNull()
  })

  it('returns null for unmapped extensions', () => {
    expect(resolveLanguage('archive.bin')).toBeNull()
  })
})

describe('highlightLines', () => {
  it('returns one entry per source line', () => {
    expect(highlightLines('a\nb\nc', null)).toEqual(['a', 'b', 'c'])
  })

  it('HTML-escapes plain-text lines', () => {
    const out = highlightLines('<script>alert(1)</script>', null)
    expect(out).toHaveLength(1)
    expect(out[0]).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(out[0]).not.toContain('<script>')
  })

  it('falls back to plain text for unknown languages', () => {
    const out = highlightLines('foo & bar', 'not-a-language')
    expect(out).toEqual(['foo &amp; bar'])
  })

  it('returns an empty string for empty input', () => {
    expect(highlightLines('', null)).toEqual([''])
    expect(highlightLines('', 'typescript')).toEqual([''])
  })

  it('produces hljs-* tokens for typescript', () => {
    const out = highlightLines('const x = 1', 'typescript')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatch(/hljs-keyword/)
    expect(out[0]).toContain('const')
  })

  it('keeps multi-line tokens consistent across lines', () => {
    const src = '/* line one\n   line two */\nconst x = 1'
    const out = highlightLines(src, 'typescript')
    expect(out).toHaveLength(3)
    expect(out[0]).toMatch(/hljs-comment/)
    expect(out[1]).toMatch(/hljs-comment/)
    expect(out[0].endsWith('</span>')).toBe(true)
    expect(out[1].startsWith('<span')).toBe(true)
  })

  it('each highlighted line has balanced span tags', () => {
    const src = `function f() {\n  return "hello\\nworld"\n}`
    const out = highlightLines(src, 'typescript')
    for (const line of out) {
      const opens = (line.match(/<span\b/g) ?? []).length
      const closes = (line.match(/<\/span>/g) ?? []).length
      expect(opens).toBe(closes)
    }
  })

  it('preserves trailing blank line', () => {
    const out = highlightLines('a\n', 'typescript')
    expect(out).toHaveLength(2)
    expect(out[1]).toBe('')
  })

  it('produces hljs-* tokens for markdown', () => {
    const out = highlightLines('# Title\n\n- item\n[link](https://x.y)', 'markdown')
    expect(out).toHaveLength(4)
    expect(out[0]).toMatch(/hljs-section/)   // heading
    expect(out[2]).toMatch(/hljs-bullet/)    // list marker
    expect(out[3]).toMatch(/hljs-link/)      // link target
  })

  it('produces hljs-* tokens for yaml', () => {
    const out = highlightLines('name: ci\non:\n  push: {}', 'yaml')
    expect(out[0]).toMatch(/hljs-attr/)
  })
})
