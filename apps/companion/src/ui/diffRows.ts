// Unified patch → render rows with old/new line numbers. Hunk-aware: inside a
// hunk the @@ counts decide what a line is, so a deleted "-- comment" line is
// content, not a `---` header (classifyDiffLine alone can't tell).
export type DiffRow =
  | { kind: 'hunk'; text: string }
  | { kind: 'meta'; text: string }
  | { kind: 'add' | 'del' | 'ctx'; code: string; oldNo?: number; newNo?: number }
  | { kind: 'note'; text: string } // "\ No newline at end of file"

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

export function diffRows(patch: string, opts: { meta?: boolean } = {}): DiffRow[] {
  const out: DiffRow[] = []
  let oldNo = 0, newNo = 0, oldLeft = 0, newLeft = 0
  for (const l of patch.replace(/\r\n/g, '\n').split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      if (l.startsWith('+')) { out.push({ kind: 'add', code: l.slice(1), newNo: newNo++ }); newLeft--; continue }
      if (l.startsWith('-')) { out.push({ kind: 'del', code: l.slice(1), oldNo: oldNo++ }); oldLeft--; continue }
      if (l.startsWith('\\')) { out.push({ kind: 'note', text: l.slice(2) }); continue }
      out.push({ kind: 'ctx', code: l.startsWith(' ') ? l.slice(1) : l, oldNo: oldNo++, newNo: newNo++ }); oldLeft--; newLeft--; continue
    }
    const h = HUNK.exec(l)
    if (h) {
      oldNo = Number(h[1]); newNo = Number(h[3])
      oldLeft = h[2] === undefined ? 1 : Number(h[2]); newLeft = h[4] === undefined ? 1 : Number(h[4])
      out.push({ kind: 'hunk', text: h[5].trim() ? `@@ ${h[5].trim()}` : `@@ −${h[1]} +${h[3]}` })
      continue
    }
    if (l.startsWith('\\')) { out.push({ kind: 'note', text: l.slice(2) }); continue }
    if (opts.meta && l) out.push({ kind: 'meta', text: l })
  }
  return out
}

// Lockfiles and similar: collapsed until tapped on the phone.
const GENERATED = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|go\.sum|flake\.lock|.*\.min\.(js|css)|.*\.snap)$/
export const COLLAPSE_LINES = 1500

export function collapseReason(f: { path: string; binary: boolean; lines: number }): 'binary' | 'generated' | 'large' | null {
  if (f.binary) return 'binary'
  if (GENERATED.test(f.path)) return 'generated'
  if (f.lines > COLLAPSE_LINES) return 'large'
  return null
}
