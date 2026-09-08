import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConflictFile, ConflictSection } from '../../../preload/index'
import { useToasts } from '../Toast/Toast'
import { resolveLanguage, highlightLines } from '../../lib/highlight'
import {
  diffBlock, markRanges, classifyResolved, blockText, findNearest,
  type BlockDiff, type LineOrigin, type Range,
} from '../../lib/conflictDiff'
import { ConfirmModal } from '../AppAux/AuxComponents'
import { Icon } from '../Icons/Icon'
import { FindBar } from '../FindBar/FindBar'
import { findInLines, matchesByLine, cycle, markHtmlMatches, type TextMatch } from '../../lib/findInText'
import './ConflictEditor.css'

interface ConflictEditorProps {
  filePath: string
  onClose: () => void
  onResolved: (path: string) => void
}

// Three-pane editor showing the FULL file in every pane:
//
//   ┌─────────────────── current ─────────────────┬─────────── incoming ───────────┐
//   │ shared line (dimmed)                         │ shared line (dimmed)           │
//   │ ▸ Block 1 · [Use this] [Use both]            │ ▸ Block 1 · [Use this] [Use both]│
//   │ conflict line identical on both sides        │ conflict line identical …      │
//   │ conflict line that DIFFERS (word marks)      │ conflict line that DIFFERS     │
//   ├──────────────────────────────────────────────┴────────────────────────────────┤
//   │ Resolved — syntax-highlighted, editable; gutter colour = where each line     │
//   │ came from (current / incoming / both / hand-edited / leftover marker)        │
//   └───────────────────────────────────────────────────────────────────────────────┘
//
// Side panes are read-only annotated views. Inside a conflict block, lines the
// two sides share are tinted lightly and lines that differ are tinted strongly
// with the changed words marked, so the eye lands on the actual difference.
// Clicking a line inserts it into the resolved editor at the cursor; the
// per-block buttons swap that block's text in place.
//
// The resolved pane is a plain <textarea> for editing, with a syntax-
// highlighted layer rendered underneath it (the textarea's own text is
// transparent). Both share font metrics and scroll position.

type Choice = 'current' | 'incoming' | 'both' | 'custom'
type Side = 'current' | 'incoming'

interface SideLine {
  text: string
  html: string
  /** Index into `blocks`, or null for shared text. */
  block: number | null
  /** Within a block: does this line also appear on the other side? */
  same: boolean
  /** First line of its block — the block header renders above it. */
  blockStart: boolean
}

interface Block {
  sectionIdx: number
  section: Extract<ConflictSection, { kind: 'conflict' }>
  diff: BlockDiff
}

const LINE_H = 18 // px — must match .ce-side-line / .ce-rline line-height

export const ConflictEditor: React.FC<ConflictEditorProps> = ({ filePath, onClose, onResolved }) => {
  const [file, setFile] = useState<ConflictFile | null>(null)
  const [resolved, setResolved] = useState<string>('')
  const [choices, setChoices] = useState<Choice[]>([])
  const [activeBlock, setActiveBlock] = useState(0)
  const [saving, setSaving] = useState(false)
  const [confirmMarkers, setConfirmMarkers] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hlRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLDivElement>(null)
  const incomingRef = useRef<HTMLDivElement>(null)
  const toast = useToasts()

  // In-file find (Cmd/Ctrl+F). App.tsx hands the shortcut to the editor while
  // a conflict file is open. All three panes are searched: the resolved
  // buffer first (it is what the user is editing), then current, then incoming.
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findActive, setFindActive] = useState(0)
  const [findFocusReq, setFindFocusReq] = useState(0)

  const lang = useMemo(() => resolveLanguage(filePath), [filePath])

  // ── Conflict blocks + their intra-block diff ────────────────────────────
  const blocks = useMemo<Block[]>(() => {
    if (!file) return []
    const out: Block[] = []
    file.sections.forEach((s, i) => {
      if (s.kind !== 'conflict') return
      out.push({ sectionIdx: i, section: s, diff: diffBlock(s.current.split('\n'), s.incoming.split('\n')) })
    })
    return out
  }, [file])

  // ── Side panes ──────────────────────────────────────────────────────────
  // Full-file line lists per side; conflict lines carry their block index,
  // same/changed flag and word-diff ranges (applied on top of the syntax
  // highlighting so both survive).
  const panes = useMemo(() => {
    const empty = { lines: [] as SideLine[], fullText: '', blockStarts: [] as number[] }
    if (!file) return { current: empty, incoming: empty }
    const build = (side: Side) => {
      const raw: { text: string; block: number | null; same: boolean; ranges?: Range[]; blockStart: boolean }[] = []
      const blockStarts: number[] = []
      let b = 0
      for (const s of file.sections) {
        if (s.kind === 'shared') {
          for (const t of s.text.split('\n')) raw.push({ text: t, block: null, same: false, blockStart: false })
        } else {
          const d = blocks[b].diff[side]
          blockStarts.push(raw.length)
          d.forEach((l, i) => raw.push({ text: l.text, block: b, same: l.same, ranges: l.ranges, blockStart: i === 0 }))
          b++
        }
      }
      const fullText = raw.map((l) => l.text).join('\n')
      const html = highlightLines(fullText, lang)
      const lines: SideLine[] = raw.map((l, i) => ({
        text: l.text,
        block: l.block,
        same: l.same,
        blockStart: l.blockStart,
        html: l.ranges && l.ranges.length ? markRanges(html[i] ?? '', l.ranges) : (html[i] ?? ''),
      }))
      return { lines, fullText, blockStarts }
    }
    return { current: build('current'), incoming: build('incoming') }
  }, [file, blocks, lang])

  // ── Resolved pane ───────────────────────────────────────────────────────
  const resolvedLines = useMemo(() => resolved.split('\n'), [resolved])
  const resolvedHtml = useMemo(() => highlightLines(resolved, lang), [resolved, lang])
  const origins = useMemo(() => classifyResolved(resolvedLines, file), [resolvedLines, file])
  const originCounts = useMemo(() => {
    const c: Record<LineOrigin, number> = { shared: 0, current: 0, incoming: 0, both: 0, edited: 0, marker: 0, blank: 0 }
    for (const o of origins) c[o]++
    return c
  }, [origins])

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancel = false
    window.gitApi.getConflictFile(filePath).then((f) => {
      if (cancel) return
      setFile(f)
      // Seed the resolved buffer with the current side's full file. Gives the
      // user a working baseline; they can swap blocks or hand-edit from there.
      setResolved(f.sections.map((s) => s.kind === 'shared' ? s.text : s.current).join('\n'))
      setChoices(f.sections.filter((s) => s.kind === 'conflict').map(() => 'current' as Choice))
      setActiveBlock(0)
    })
    return () => { cancel = true }
  }, [filePath])

  // Cmd/Ctrl+F opens or re-focuses the find bar (also from inside the
  // textarea). Escape closes the find bar if open, otherwise the editor —
  // except from the textarea, where it must stay a harmless keypress.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setFindOpen(true)
        setFindFocusReq((n) => n + 1)
        return
      }
      if (e.key !== 'Escape') return
      if (findOpen) { setFindOpen(false); return }
      if (!(e.target instanceof HTMLTextAreaElement)) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, findOpen])

  // ── Editing helpers ─────────────────────────────────────────────────────
  // Insert text into the resolved textarea at the current cursor. Each
  // insertion ends with a newline so successive clicks build up cleanly.
  const insertAtCursor = useCallback((text: string) => {
    const el = textareaRef.current
    if (!el) { setResolved((r) => r + (r.endsWith('\n') ? '' : '\n') + text + '\n'); return }
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    const insert = text + '\n'
    setResolved(el.value.slice(0, start) + insert + el.value.slice(end))
    // Restore selection just after the inserted text. Defer until after React
    // applies the new value, otherwise the assignment is clobbered.
    queueMicrotask(() => {
      el.focus()
      const pos = start + insert.length
      el.setSelectionRange(pos, pos)
    })
  }, [])

  // Where block `b` is *expected* to start in the resolved buffer, assuming
  // the sections before it are unedited and hold their chosen text. Used only
  // to disambiguate when the previous text appears more than once.
  const expectedOffset = useCallback((b: number) => {
    if (!file) return 0
    let off = 0
    let bi = 0
    for (let i = 0; i < blocks[b].sectionIdx; i++) {
      const s = file.sections[i]
      if (s.kind === 'shared') off += s.text.length + 1
      else {
        const ch = choices[bi] ?? 'current'
        off += blockText(s, ch === 'custom' ? 'current' : ch).length + 1
        bi++
      }
    }
    return off
  }, [file, blocks, choices])

  // Swap block `b`'s text in the resolved buffer for the chosen side. Finds the
  // block's previous text nearest to where it should be and replaces it in
  // place, so surrounding hand-edits survive. If it can't be found (the user
  // edited the block itself) the new text goes in at the cursor instead.
  const applyChoice = useCallback((b: number, side: 'current' | 'incoming' | 'both') => {
    const block = blocks[b]
    if (!block) return
    const prev = choices[b] ?? 'current'
    const next = blockText(block.section, side)
    const expected = expectedOffset(b)
    const el = textareaRef.current
    const finish = (at: number, replacedLen: number) => {
      setResolved((r) => r.slice(0, at) + next + r.slice(at + replacedLen))
      setChoices((c) => c.map((x, i) => (i === b ? side : x)))
      setActiveBlock(b)
      queueMicrotask(() => {
        if (!el) return
        el.focus()
        // Collapsed caret after the swapped text — a live selection here would
        // make the next keystroke replace the whole block.
        el.setSelectionRange(at + next.length, at + next.length)
        el.scrollTop = Math.max(0, resolved.slice(0, at).split('\n').length * LINE_H - 2 * LINE_H)
      })
    }
    if (prev !== 'custom') {
      const prevText = blockText(block.section, prev)
      if (prevText === '') {
        // The previous choice was an empty side (deletion conflict): nothing
        // to find, so insert where the block structurally belongs.
        finish(Math.min(expected, resolved.length), 0)
        return
      }
      const at = findNearest(resolved, prevText, expected)
      if (at !== -1) { finish(at, prevText.length); return }
    }
    insertAtCursor(next)
    setChoices((c) => c.map((x, i) => (i === b ? 'custom' : x)))
    toast.info('Inserted at cursor', 'The block had been edited, so it could not be swapped in place.')
  }, [blocks, choices, expectedOffset, resolved, insertAtCursor, toast])

  const takeAll = useCallback((side: Side) => {
    if (!file) return
    setResolved(file.sections.map((s) => s.kind === 'shared' ? s.text : s[side]).join('\n'))
    setChoices(blocks.map(() => side))
  }, [file, blocks])

  // ── Block navigation ────────────────────────────────────────────────────
  // Scrolls all three panes so block `b` sits near the top. The resolved pane
  // has no structural link to blocks, so we look for the first line matching
  // any line of the block (chosen side first).
  const gotoBlock = useCallback((b: number) => {
    if (blocks.length === 0) return
    const clamped = Math.max(0, Math.min(blocks.length - 1, b))
    setActiveBlock(clamped)
    const scroll = (el: HTMLElement | null, line: number) => {
      if (!el) return
      el.scrollTop = Math.max(0, line * LINE_H - LINE_H)
    }
    // Block header rows add one extra row per preceding block in the side panes.
    scroll(currentRef.current, panes.current.blockStarts[clamped] + clamped)
    scroll(incomingRef.current, panes.incoming.blockStarts[clamped] + clamped)
    const ch = choices[clamped] ?? 'current'
    const want = new Set(blockText(blocks[clamped].section, ch === 'custom' ? 'both' : ch).split('\n').filter((l) => l.trim() !== ''))
    const idx = resolvedLines.findIndex((l) => want.has(l))
    if (idx !== -1 && textareaRef.current) textareaRef.current.scrollTop = Math.max(0, idx * LINE_H - LINE_H)
  }, [blocks, panes, choices, resolvedLines])

  // ── Save ────────────────────────────────────────────────────────────────
  const hasMarkers = originCounts.marker > 0

  const doSave = useCallback(async () => {
    setConfirmMarkers(false)
    setSaving(true)
    try {
      const w = await window.gitApi.writeFile(filePath, resolved)
      if (!w.success) { toast.error('Write failed', w.error); return }
      const m = await window.gitApi.markResolved([filePath])
      if (!m.success) { toast.error('Mark resolved failed', m.error); return }
      toast.success('Resolved', filePath)
      onResolved(filePath)
    } finally { setSaving(false) }
  }, [filePath, resolved, toast, onResolved])

  // Saving with conflict markers still present routes through an in-app confirm
  // (native window.confirm is unreliable in this Electron build).
  const handleSave = useCallback(() => {
    if (!file) return
    if (hasMarkers) { setConfirmMarkers(true); return }
    doSave()
  }, [file, hasMarkers, doSave])

  // Keep the highlight layer under the textarea in lockstep with its scroll.
  const syncHighlight = useCallback(() => {
    const ta = textareaRef.current, hl = hlRef.current
    if (!ta || !hl) return
    hl.scrollTop = ta.scrollTop
    hl.scrollLeft = ta.scrollLeft
  }, [])

  // ── In-file find ────────────────────────────────────────────────────────
  type FindPane = 'resolved' | 'current' | 'incoming'
  type PaneMatch = TextMatch & { pane: FindPane }
  const currentTexts = useMemo(() => panes.current.lines.map((l) => l.text), [panes])
  const incomingTexts = useMemo(() => panes.incoming.lines.map((l) => l.text), [panes])
  const findMatches = useMemo<PaneMatch[]>(() => {
    if (!findOpen || findQuery === '') return []
    const tag = (pane: FindPane, ms: TextMatch[]) => ms.map((m) => ({ ...m, pane }))
    return [
      ...tag('resolved', findInLines(resolvedLines, findQuery)),
      ...tag('current', findInLines(currentTexts, findQuery)),
      ...tag('incoming', findInLines(incomingTexts, findQuery)),
    ]
  }, [findOpen, findQuery, resolvedLines, currentTexts, incomingTexts])
  const findByPane = useMemo(() => ({
    resolved: matchesByLine(findMatches.filter((m) => m.pane === 'resolved')),
    current: matchesByLine(findMatches.filter((m) => m.pane === 'current')),
    incoming: matchesByLine(findMatches.filter((m) => m.pane === 'incoming')),
  }), [findMatches])
  const activeMatch = findMatches[cycle(findActive, findMatches.length)] ?? null
  const activeFor = (pane: FindPane): { line: number; range: Range } | null =>
    activeMatch && activeMatch.pane === pane ? { line: activeMatch.line, range: [activeMatch.start, activeMatch.end] } : null

  useEffect(() => { setFindActive(0) }, [findQuery, resolvedLines, currentTexts, incomingTexts])
  // Scroll the pane holding the active hit. The resolved pane is a textarea
  // with a mirrored highlight layer, so it scrolls by line height; the side
  // panes are ordinary DOM and can use scrollIntoView on the tagged row.
  useEffect(() => {
    if (!activeMatch) return
    if (activeMatch.pane === 'resolved') {
      const ta = textareaRef.current
      if (!ta) return
      ta.scrollTop = Math.max(0, activeMatch.line * LINE_H - Math.floor(ta.clientHeight / 2))
      syncHighlight()
      return
    }
    const pane = activeMatch.pane === 'current' ? currentRef.current : incomingRef.current
    pane?.querySelector<HTMLElement>(`[data-find-line="${activeMatch.line}"]`)?.scrollIntoView?.({ block: 'center' })
  }, [activeMatch, syncHighlight])
  const findNext = () => setFindActive((i) => cycle(i + 1, findMatches.length))
  const findPrev = () => setFindActive((i) => cycle(i - 1, findMatches.length))

  if (!file) return <div className="ce-loading">Loading conflict file…</div>

  const conflictCount = blocks.length
  const currentLabel = blocks[0]?.section.currentLabel ?? 'current'
  const incomingLabel = blocks[0]?.section.incomingLabel ?? 'incoming'

  return (
    <div className="conflict-editor">
      <div className="ce-header">
        <span className="ce-filename mono">{filePath}</span>
        <span className="ce-progress">{conflictCount} conflict block{conflictCount === 1 ? '' : 's'}</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save & Mark Resolved'}
        </button>
        <button className="ce-close" onClick={onClose} title="Close (Esc)"><Icon name="x" size={13} /></button>
      </div>

      <div className="ce-toolbar">
        <button className="ce-action" onClick={() => takeAll('current')}><Icon name="arrow-left" size={12} /> Take all current</button>
        <button className="ce-action" onClick={() => takeAll('incoming')}>Take all incoming <Icon name="arrow-right" size={12} /></button>
        {conflictCount > 0 && (
          <span className="ce-blocknav" role="group" aria-label="Conflict block navigation">
            <button className="ce-nav" onClick={() => gotoBlock(activeBlock - 1)} disabled={activeBlock <= 0} title="Previous block"><Icon name="arrow-up" size={12} /></button>
            <span className="ce-blocknav-label mono">block {activeBlock + 1}/{conflictCount}</span>
            <button className="ce-nav" onClick={() => gotoBlock(activeBlock + 1)} disabled={activeBlock >= conflictCount - 1} title="Next block"><Icon name="arrow-down" size={12} /></button>
            <span className="ce-blocknav-sep" />
            <button className={`ce-action ce-action-current ${choices[activeBlock] === 'current' ? 'active' : ''}`} onClick={() => applyChoice(activeBlock, 'current')} title="Use the current side for this block">Use current</button>
            <button className={`ce-action ce-action-incoming ${choices[activeBlock] === 'incoming' ? 'active' : ''}`} onClick={() => applyChoice(activeBlock, 'incoming')} title="Use the incoming side for this block">Use incoming</button>
            <button className={`ce-action ce-action-both ${choices[activeBlock] === 'both' ? 'active' : ''}`} onClick={() => applyChoice(activeBlock, 'both')} title="Keep both sides (current first)">Use both</button>
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span className="ce-legend" aria-label="Where the resolved lines come from">
          <LegendChip kind="current"  n={originCounts.current}  label="current" />
          <LegendChip kind="incoming" n={originCounts.incoming} label="incoming" />
          <LegendChip kind="both"     n={originCounts.both}     label="both" />
          <LegendChip kind="edited"   n={originCounts.edited}   label="edited" />
        </span>
        {hasMarkers && <span className="ce-warning"><Icon name="warning" size={12} /> {originCounts.marker} conflict marker{originCounts.marker === 1 ? '' : 's'} left</span>}
      </div>

      {findOpen && (
        <FindBar
          query={findQuery}
          onQueryChange={setFindQuery}
          count={findMatches.length}
          active={cycle(findActive, findMatches.length)}
          onNext={findNext}
          onPrev={findPrev}
          onClose={() => setFindOpen(false)}
          focusRequest={findFocusReq}
          placeholder="Find in file (resolved, current, incoming)…"
        />
      )}

      <div className="ce-body">
        <div className="ce-grid">
          <div className="ce-top-row">
            <SidePane
              label={`Current · ${currentLabel}`}
              side="current"
              lines={panes.current.lines}
              choices={choices}
              activeBlock={activeBlock}
              onLineClick={insertAtCursor}
              onUseBlock={(b) => applyChoice(b, 'current')}
              onUseBoth={(b) => applyChoice(b, 'both')}
              onFocusBlock={setActiveBlock}
              scrollRef={currentRef}
              otherRef={incomingRef}
              findRanges={findByPane.current}
              findActive={activeFor('current')}
            />
            <SidePane
              label={`Incoming · ${incomingLabel}`}
              side="incoming"
              lines={panes.incoming.lines}
              choices={choices}
              activeBlock={activeBlock}
              onLineClick={insertAtCursor}
              onUseBlock={(b) => applyChoice(b, 'incoming')}
              onUseBoth={(b) => applyChoice(b, 'both')}
              onFocusBlock={setActiveBlock}
              scrollRef={incomingRef}
              otherRef={currentRef}
              findRanges={findByPane.incoming}
              findActive={activeFor('incoming')}
            />
          </div>
          <div className="ce-bottom-row">
            <div className="ce-pane ce-pane-mid">
              <div className="ce-pane-head">Resolved · editable · full file</div>
              <div className="ce-result">
                <div className="ce-result-hl mono" ref={hlRef} aria-hidden="true">
                  {resolvedLines.map((_, i) => {
                    const ranges = findByPane.resolved.get(i)
                    const act = activeFor('resolved')
                    const html = ranges
                      ? markHtmlMatches(resolvedHtml[i] ?? '', ranges, act && act.line === i ? act.range : null)
                      : (resolvedHtml[i] || '&#8203;')
                    return (
                      <div key={i} className={`ce-rline ce-origin-${origins[i]}`}>
                        <span className="ce-rgutter">{i + 1}</span>
                        <span className="ce-rtag" title={ORIGIN_TITLE[origins[i]]}>{ORIGIN_TAG[origins[i]]}</span>
                        <code className="hljs ce-rcode" dangerouslySetInnerHTML={{ __html: html }} />
                      </div>
                    )
                  })}
                </div>
                <textarea
                  ref={textareaRef}
                  className="ce-textarea mono"
                  value={resolved}
                  onChange={(e) => setResolved(e.target.value)}
                  onScroll={syncHighlight}
                  wrap="off"
                  spellCheck={false}
                  aria-label="Resolved file content"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {confirmMarkers && (
        <ConfirmModal
          title="Conflict markers still present"
          message="The resolved file still contains conflict markers (<<<<<<<)."
          detail="Save anyway and mark the file resolved?"
          confirmLabel="Save anyway"
          danger
          onClose={() => setConfirmMarkers(false)}
          onConfirm={doSave}
        />
      )}
    </div>
  )
}

const ORIGIN_TAG: Record<LineOrigin, string> = {
  shared: '', blank: '', current: 'C', incoming: 'I', both: 'B', edited: 'E', marker: '!',
}
const ORIGIN_TITLE: Record<LineOrigin, string> = {
  shared: 'Unchanged line',
  blank: '',
  current: 'From the current side',
  incoming: 'From the incoming side',
  both: 'Identical on both sides',
  edited: 'Hand-edited (matches neither side)',
  marker: 'Leftover conflict marker',
}

function LegendChip({ kind, n, label }: { kind: LineOrigin; n: number; label: string }) {
  return (
    <span className={`ce-chip ce-chip-${kind} ${n === 0 ? 'ce-chip-zero' : ''}`} title={`${n} line${n === 1 ? '' : 's'} ${ORIGIN_TITLE[kind].toLowerCase()}`}>
      <span className="ce-chip-dot" />{label} <span className="mono">{n}</span>
    </span>
  )
}

function SidePane({
  label, side, lines, choices, activeBlock, onLineClick, onUseBlock, onUseBoth, onFocusBlock, scrollRef, otherRef,
  findRanges, findActive,
}: {
  label: string
  side: Side
  lines: SideLine[]
  choices: Choice[]
  activeBlock: number
  onLineClick: (line: string) => void
  onUseBlock: (block: number) => void
  onUseBoth: (block: number) => void
  onFocusBlock: (block: number) => void
  scrollRef: React.RefObject<HTMLDivElement>
  otherRef: React.RefObject<HTMLDivElement>
  /** Find hits per line index of `lines`; absent when find is closed. */
  findRanges?: Map<number, Range[]>
  findActive?: { line: number; range: Range } | null
}) {
  // Mirror scroll to the other side pane. The guard breaks the feedback loop:
  // setting the other pane's scrollTop fires ITS onScroll, which would set
  // ours again.
  const syncing = useRef(false)
  const onScroll = () => {
    const from = scrollRef.current, to = otherRef.current
    if (!from || !to) return
    if (syncing.current) { syncing.current = false; return }
    if (to.scrollTop !== from.scrollTop || to.scrollLeft !== from.scrollLeft) {
      syncing.current = true
      to.scrollTop = from.scrollTop
      to.scrollLeft = from.scrollLeft
    }
  }

  let lineNo = 0
  return (
    <div className={`ce-pane ce-pane-${side}`}>
      <div className="ce-pane-head">{label}</div>
      <div className="ce-pane-body mono" ref={scrollRef} onScroll={onScroll}>
        {lines.map((l, i) => {
          lineNo++
          const b = l.block
          const inBlock = b !== null
          const chosen = inBlock && (choices[b] === side || choices[b] === 'both')
          const cls = [
            'ce-side-line',
            inBlock ? 'ce-side-line-conflict' : '',
            inBlock ? (l.same ? 'ce-line-same' : 'ce-line-changed') : '',
            inBlock && b === activeBlock ? 'ce-line-active' : '',
            chosen ? 'ce-line-chosen' : '',
          ].join(' ')
          return (
            <React.Fragment key={i}>
              {inBlock && l.blockStart && (
                <div className={`ce-block-head ${b === activeBlock ? 'active' : ''}`} onClick={() => onFocusBlock(b)}>
                  <span className="ce-block-title">Block {b + 1}</span>
                  <span className="ce-block-state">
                    {choices[b] === side ? 'in result' : choices[b] === 'both' ? 'both in result' : choices[b] === 'custom' ? 'edited' : 'not used'}
                  </span>
                  <button className="ce-block-btn" onClick={(e) => { e.stopPropagation(); onUseBlock(b) }} title={`Replace this block in the result with the ${side} side`}>Use this</button>
                  <button className="ce-block-btn" onClick={(e) => { e.stopPropagation(); onUseBoth(b) }} title="Keep both sides of this block (current first)">Use both</button>
                </div>
              )}
              <button
                className={cls}
                onClick={() => { if (inBlock) onFocusBlock(b); onLineClick(l.text) }}
                title="Click to insert this line at the cursor in the resolved editor"
                data-find-line={i}
              >
                <span className="ce-side-lineno">{lineNo}</span>
                {l.text === ''
                  ? <span className="ce-side-text">​</span>
                  : <span className="ce-side-text hljs" dangerouslySetInnerHTML={{ __html: findRanges?.get(i)
                      ? markHtmlMatches(l.html, findRanges.get(i)!, findActive && findActive.line === i ? findActive.range : null)
                      : l.html }} />}
              </button>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
