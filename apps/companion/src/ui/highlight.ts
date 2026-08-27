// Tiny syntax highlighter for diff lines. Zero dependencies, regex-driven,
// one language table; good enough to make code *readable* on a phone (it is
// not a parser). Unknown extensions get strings/comments/numbers only.
export type TokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'type' | 'punct' | 'attr' | 'tag'
export interface Token { text: string; kind: TokenKind }

interface Lang { keywords: Set<string>; types?: RegExp; lineComment?: string[]; blockComment?: boolean; hash?: boolean; tags?: boolean; attr?: boolean }

const KW = (s: string) => new Set(s.split(/\s+/).filter(Boolean))
const C_LIKE = 'if else for while do switch case default break continue return function class extends new this super import export from as const let var typeof instanceof in of try catch finally throw async await yield static get set delete void null undefined true false interface type enum implements namespace declare readonly public private protected abstract override keyof infer never unknown any satisfies'
const LANGS: Record<string, Lang> = {
  js: { keywords: KW(C_LIKE), types: /^[A-Z][A-Za-z0-9_]*$/, lineComment: ['//'], blockComment: true },
  json: { keywords: KW('true false null') },
  css: { keywords: KW('important inherit initial none auto'), lineComment: [], blockComment: true, attr: true },
  py: { keywords: KW('def class return if elif else for while in not and or is None True False import from as with try except finally raise lambda pass break continue yield global nonlocal assert del async await match case'), types: /^[A-Z][A-Za-z0-9_]*$/, hash: true },
  go: { keywords: KW('func package import type struct interface map chan go defer return if else for range switch case default break continue fallthrough select var const nil true false make new len cap append'), types: /^(string|int|int64|int32|uint|uint8|byte|rune|bool|float64|float32|error|any|[A-Z][A-Za-z0-9_]*)$/, lineComment: ['//'], blockComment: true },
  rs: { keywords: KW('fn let mut pub use mod struct enum impl trait for in if else match while loop return self Self crate super as where dyn ref move async await unsafe const static type true false Some None Ok Err'), types: /^(u8|u16|u32|u64|usize|i8|i16|i32|i64|isize|f32|f64|bool|str|String|Vec|Option|Result|Box|[A-Z][A-Za-z0-9_]*)$/, lineComment: ['//'], blockComment: true },
  kt: { keywords: KW('fun val var class object interface data sealed enum when if else for while do return import package override private public internal protected open abstract companion init this super null true false is as in try catch finally throw lateinit by suspend inline'), types: /^[A-Z][A-Za-z0-9_]*$/, lineComment: ['//'], blockComment: true },
  swift: { keywords: KW('func let var class struct enum protocol extension import if else guard for while repeat switch case default return self Self init deinit throws throw try catch async await nil true false public private internal fileprivate open static override mutating some any where in is as'), types: /^[A-Z][A-Za-z0-9_]*$/, lineComment: ['//'], blockComment: true },
  java: { keywords: KW('public private protected static final abstract class interface enum extends implements import package new return if else for while do switch case default break continue try catch finally throw throws this super null true false void int long short byte char boolean float double var record sealed permits instanceof'), types: /^[A-Z][A-Za-z0-9_]*$/, lineComment: ['//'], blockComment: true },
  sh: { keywords: KW('if then else elif fi for while do done case esac in function return exit export local set unset echo source cd true false'), hash: true },
  yaml: { keywords: KW('true false null yes no on off'), hash: true, attr: true },
  md: { keywords: KW('') },
  html: { keywords: KW(''), tags: true, blockComment: false },
  sql: { keywords: KW('select from where insert into values update set delete create table alter drop index join left right inner outer on as and or not null primary key references group by order limit offset having union all distinct case when then else end begin commit rollback'), lineComment: ['--'], blockComment: true },
  gradle: { keywords: KW('apply plugin plugins id dependencies implementation api android defaultConfig def if else true false null'), lineComment: ['//'], blockComment: true },
}
const EXT: Record<string, string> = {
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js', json: 'json', jsonc: 'json', css: 'css', scss: 'css', less: 'css',
  py: 'py', go: 'go', rs: 'rs', kt: 'kt', kts: 'kt', swift: 'swift', java: 'java', sh: 'sh', bash: 'sh', zsh: 'sh', yml: 'yaml', yaml: 'yaml', toml: 'yaml',
  md: 'md', markdown: 'md', html: 'html', htm: 'html', xml: 'html', svg: 'html', vue: 'html', sql: 'sql', gradle: 'gradle', c: 'java', h: 'java', cc: 'java', cpp: 'java', hpp: 'java', cs: 'java', m: 'java', rb: 'py', php: 'js', dart: 'java', lua: 'py', r: 'py',
}

export function languageFor(path: string): string | null {
  const base = path.split('/').pop() ?? path
  if (/^(Dockerfile|Makefile)$/i.test(base)) return 'sh'
  if (/^\.(env|gitignore|npmrc|editorconfig)/.test(base)) return 'sh'
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : ''
  return EXT[ext] ?? null
}

const WORD = /^[A-Za-z_$][\w$]*/
const NUMBER = /^(0x[0-9a-fA-F]+|\d+(\.\d+)?([eE][+-]?\d+)?)/
const PUNCT = /^[{}()[\];,.<>=+\-*/%!&|^~?:@#]+/

/** Tokenize one line of code. Block comments are not tracked across lines (a diff shows lines out of context anyway). */
export function tokenize(line: string, lang: string | null): Token[] {
  const L = lang ? LANGS[lang] : undefined
  const out: Token[] = []
  const push = (text: string, kind: TokenKind) => { if (!text) return; const last = out[out.length - 1]; if (last && last.kind === kind && kind === 'plain') last.text += text; else out.push({ text, kind }) }
  let i = 0
  while (i < line.length) {
    const rest = line.slice(i)
    // comments
    if (L?.hash && rest.startsWith('#')) { push(rest, 'comment'); break }
    if (L?.lineComment?.some((c) => rest.startsWith(c))) { push(rest, 'comment'); break }
    if (L?.blockComment && rest.startsWith('/*')) { const end = rest.indexOf('*/'); const len = end < 0 ? rest.length : end + 2; push(rest.slice(0, len), 'comment'); i += len; continue }
    if (L?.tags && rest.startsWith('<!--')) { const end = rest.indexOf('-->'); const len = end < 0 ? rest.length : end + 3; push(rest.slice(0, len), 'comment'); i += len; continue }
    // strings
    const q = rest[0]
    if (q === '"' || q === "'" || q === '`') {
      let j = 1
      while (j < rest.length && rest[j] !== q) { if (rest[j] === '\\') j++; j++ }
      push(rest.slice(0, Math.min(j + 1, rest.length)), 'string'); i += Math.min(j + 1, rest.length); continue
    }
    // tags / attrs (markup)
    if (L?.tags && rest[0] === '<') { const m = /^<\/?[A-Za-z][\w:-]*/.exec(rest); if (m) { push(m[0], 'tag'); i += m[0].length; continue } }
    if (L?.attr) { const m = /^[A-Za-z_-][\w-]*(?=\s*:)/.exec(rest); if (m && (i === 0 || /^\s*$/.test(line.slice(0, i)))) { push(m[0], 'attr'); i += m[0].length; continue } }
    // numbers
    const n = NUMBER.exec(rest)
    if (n && !/[\w$]/.test(line[i - 1] ?? ' ')) { push(n[0], 'number'); i += n[0].length; continue }
    // words
    const w = WORD.exec(rest)
    if (w) {
      const word = w[0]
      const kind: TokenKind = L?.keywords.has(word) ? 'keyword' : L?.types?.test(word) ? 'type' : 'plain'
      push(word, kind); i += word.length; continue
    }
    const p = PUNCT.exec(rest)
    if (p) { push(p[0], 'punct'); i += p[0].length; continue }
    push(rest[0], 'plain'); i++
  }
  return out
}

/** Split a unified-diff line into its marker and code, telling the renderer how to tint it. */
export function classifyDiffLine(l: string): { kind: 'add' | 'del' | 'hunk' | 'meta' | 'ctx'; marker: string; code: string } {
  if (l.startsWith('@@')) return { kind: 'hunk', marker: '', code: l }
  if (/^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode|Binary files)/.test(l)) return { kind: 'meta', marker: '', code: l }
  if (l.startsWith('+')) return { kind: 'add', marker: '+', code: l.slice(1) }
  if (l.startsWith('-')) return { kind: 'del', marker: '-', code: l.slice(1) }
  return { kind: 'ctx', marker: ' ', code: l.startsWith(' ') ? l.slice(1) : l }
}
