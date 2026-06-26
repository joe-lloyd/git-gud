// Syntax-highlight helper for diff and conflict views.
//
// Adding a language:
//   1. import its grammar from `highlight.js/lib/languages/<name>`
//   2. add `hljs.registerLanguage('<name>', mod)` in registerLanguages()
//   3. add the file extension(s) to EXT_MAP below
//
// highlight.js core is imported standalone so only the grammars listed here
// land in the renderer bundle.
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import scss from 'highlight.js/lib/languages/scss'
import go from 'highlight.js/lib/languages/go'

let registered = false
function registerLanguages(): void {
  if (registered) return
  hljs.registerLanguage('javascript', javascript)
  hljs.registerLanguage('typescript', typescript)
  hljs.registerLanguage('json', json)
  hljs.registerLanguage('bash', bash)
  hljs.registerLanguage('css', css)
  hljs.registerLanguage('scss', scss)
  hljs.registerLanguage('go', go)
  registered = true
}
registerLanguages()

// Extension → highlight.js language id. `null` means "render as plain text".
// Keys are lowercase, no leading dot. Dotfiles like `.env` use the bare key.
const EXT_MAP: Record<string, string | null> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  env: 'bash',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  go: 'go',
  txt: null,
}

export function resolveLanguage(filePath: string): string | null {
  const base = filePath.split('/').pop() ?? filePath
  const dot = base.lastIndexOf('.')
  let ext: string
  if (dot === -1) ext = base
  else if (dot === 0) ext = base.slice(1) // dotfile, e.g. ".env"
  else ext = base.slice(dot + 1)
  const key = ext.toLowerCase()
  if (!(key in EXT_MAP)) return null
  return EXT_MAP[key]
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Take highlight.js's whole-string HTML output and split it by '\n' into one
// fragment per source line, such that every fragment is independently valid:
// any <span> open across a newline is closed at the line end and reopened on
// the next line. Tracks an explicit stack of opening tags so nested spans
// (highlight.js uses these for sub-language regions) round-trip correctly.
function splitHighlightedHtml(html: string): string[] {
  const lines: string[] = []
  let current = ''
  const openTags: string[] = []
  let i = 0
  while (i < html.length) {
    const ch = html[i]
    if (ch === '<') {
      const end = html.indexOf('>', i)
      if (end === -1) {
        current += html.slice(i)
        break
      }
      const tag = html.slice(i, end + 1)
      current += tag
      if (tag.startsWith('</')) {
        openTags.pop()
      } else if (!tag.endsWith('/>')) {
        openTags.push(tag)
      }
      i = end + 1
    } else if (ch === '\n') {
      for (let j = openTags.length - 1; j >= 0; j--) current += '</span>'
      lines.push(current)
      current = openTags.join('')
      i++
    } else {
      current += ch
      i++
    }
  }
  lines.push(current)
  return lines
}

// Returns one HTML fragment per line in `text`. When `lang` is null or
// unregistered, every fragment is HTML-escaped plain text (no tags).
export function highlightLines(text: string, lang: string | null): string[] {
  if (lang === null) {
    return text.split('\n').map(escapeHtml)
  }
  if (!hljs.getLanguage(lang)) {
    return text.split('\n').map(escapeHtml)
  }
  try {
    const html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
    return splitHighlightedHtml(html)
  } catch {
    return text.split('\n').map(escapeHtml)
  }
}
