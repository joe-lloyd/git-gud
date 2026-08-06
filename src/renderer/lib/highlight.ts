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
import less from 'highlight.js/lib/languages/less'
import go from 'highlight.js/lib/languages/go'
import markdown from 'highlight.js/lib/languages/markdown'
import yaml from 'highlight.js/lib/languages/yaml'
import xml from 'highlight.js/lib/languages/xml'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import java from 'highlight.js/lib/languages/java'
import kotlin from 'highlight.js/lib/languages/kotlin'
import swift from 'highlight.js/lib/languages/swift'
import ruby from 'highlight.js/lib/languages/ruby'
import php from 'highlight.js/lib/languages/php'
import sql from 'highlight.js/lib/languages/sql'
import ini from 'highlight.js/lib/languages/ini'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import makefile from 'highlight.js/lib/languages/makefile'

let registered = false
function registerLanguages(): void {
  if (registered) return
  hljs.registerLanguage('javascript', javascript)
  hljs.registerLanguage('typescript', typescript)
  hljs.registerLanguage('json', json)
  hljs.registerLanguage('bash', bash)
  hljs.registerLanguage('css', css)
  hljs.registerLanguage('scss', scss)
  hljs.registerLanguage('less', less)
  hljs.registerLanguage('go', go)
  hljs.registerLanguage('markdown', markdown)
  hljs.registerLanguage('yaml', yaml)
  hljs.registerLanguage('xml', xml)
  hljs.registerLanguage('python', python)
  hljs.registerLanguage('rust', rust)
  hljs.registerLanguage('c', c)
  hljs.registerLanguage('cpp', cpp)
  hljs.registerLanguage('csharp', csharp)
  hljs.registerLanguage('java', java)
  hljs.registerLanguage('kotlin', kotlin)
  hljs.registerLanguage('swift', swift)
  hljs.registerLanguage('ruby', ruby)
  hljs.registerLanguage('php', php)
  hljs.registerLanguage('sql', sql)
  hljs.registerLanguage('ini', ini)
  hljs.registerLanguage('dockerfile', dockerfile)
  hljs.registerLanguage('makefile', makefile)
  registered = true
}
registerLanguages()

// Extension → highlight.js language id. `null` means "render as plain text".
// Keys are lowercase, no leading dot. Extensionless files (Makefile,
// Dockerfile) and dotfiles (.env, .editorconfig) match on the bare name.
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
  less: 'less',
  go: 'go',
  // docs / markup
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown', // approximation — hljs has no MDX grammar
  xml: 'xml',
  html: 'xml',
  htm: 'xml',
  xhtml: 'xml',
  svg: 'xml',
  plist: 'xml',
  // config
  yml: 'yaml',
  yaml: 'yaml',
  ini: 'ini',
  toml: 'ini', // approximation — close enough for typical tomls
  cfg: 'ini',
  properties: 'ini',
  editorconfig: 'ini',
  gitconfig: 'ini',
  npmrc: 'ini',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  mk: 'makefile',
  // languages
  py: 'python',
  pyw: 'python',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  cs: 'csharp',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  rb: 'ruby',
  gemfile: 'ruby',
  rakefile: 'ruby',
  php: 'php',
  sql: 'sql',
  // explicit plain text
  txt: null,
  gitignore: null,
  gitattributes: null,
  lock: null,
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
