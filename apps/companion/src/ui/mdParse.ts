// A small markdown subset for PR descriptions and bot comments — headings,
// lists, quotes, fenced code, tables as monospace, and inline code / bold /
// italic / links. No HTML: comments and <details>/<summary> tags are dropped,
// other tags are shown as text. Pure so it is unit-tested without React.
export type Inline = { text: string; code?: boolean; bold?: boolean; italic?: boolean; href?: string }
export type Block =
  | { kind: 'heading'; level: number; inline: Inline[] }
  | { kind: 'para'; inline: Inline[] }
  | { kind: 'item'; ordered: boolean; marker: string; depth: number; inline: Inline[] }
  | { kind: 'quote'; inline: Inline[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'table'; text: string }
  | { kind: 'rule' }

export function parseMarkdown(src: string): Block[] {
  const text = src.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?(details|summary)[^>]*>/gi, '\n')
  const lines = text.split('\n')
  const out: Block[] = []
  let para: string[] = []
  const flush = () => { if (para.length) { out.push({ kind: 'para', inline: parseInline(para.join(' ')) }); para = [] } }
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const l = raw.trim()
    const fence = /^(```|~~~)\s*([\w+-]*)/.exec(l)
    if (fence) {
      flush()
      const body: string[] = []
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i])
      out.push({ kind: 'code', lang: fence[2], text: body.join('\n') })
      continue
    }
    if (!l) { flush(); continue }
    const h = /^(#{1,6})\s+(.*)$/.exec(l)
    if (h) { flush(); out.push({ kind: 'heading', level: h[1].length, inline: parseInline(h[2]) }); continue }
    if (/^([-*_])(\s*\1){2,}$/.test(l)) { flush(); out.push({ kind: 'rule' }); continue }
    if (l.startsWith('|')) {
      flush()
      const rows: string[] = []
      for (; i < lines.length && lines[i].trim().startsWith('|'); i++) if (!/^\|[\s:|-]+\|?$/.test(lines[i].trim())) rows.push(lines[i].trim())
      i--
      out.push({ kind: 'table', text: rows.map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join('  │  ')).join('\n') })
      continue
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw)
    if (li) {
      flush()
      const ordered = /\d/.test(li[2])
      const task = /^\[([ xX])\]\s+(.*)$/.exec(li[3])
      out.push({ kind: 'item', ordered, marker: task ? (task[1] === ' ' ? '☐' : '☑') : ordered ? li[2] : '•', depth: Math.min(3, Math.floor(li[1].replace(/\t/g, '  ').length / 2)), inline: parseInline(task ? task[2] : li[3]) })
      continue
    }
    if (l.startsWith('>')) { flush(); out.push({ kind: 'quote', inline: parseInline(l.replace(/^>\s?/, '')) }); continue }
    para.push(l)
  }
  flush()
  return out
}

// Underscore emphasis (`_x_`, `__x__`) is left out on purpose: snake_case and
// dunder identifiers in PR text would trip it.
const INLINE = /(`+)([^`]+?)\1|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+)/g

export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of s.matchAll(INLINE)) {
    if (m.index! > last) out.push({ text: s.slice(last, m.index) })
    if (m[2] !== undefined) out.push({ text: m[2], code: true })
    else if (m[3] !== undefined) out.push({ text: m[3], bold: true })
    else if (m[4] !== undefined) out.push({ text: m[4], italic: true })
    else if (m[5] !== undefined) out.push({ text: m[5], href: m[6] })
    else if (m[7] !== undefined) out.push({ text: m[7], href: m[7] })
    last = m.index! + m[0].length
  }
  if (last < s.length) out.push({ text: s.slice(last) })
  return out
}
