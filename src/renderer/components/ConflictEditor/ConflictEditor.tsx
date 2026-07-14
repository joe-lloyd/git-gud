import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConflictFile } from '../../../preload/index'
import { useToasts } from '../Toast/Toast'
import { resolveLanguage, highlightLines } from '../../lib/highlight'
import { ConfirmModal } from '../AppAux/AuxComponents'
import { Icon } from '../Icons/Icon'
import './ConflictEditor.css'

interface ConflictEditorProps {
  filePath: string
  onClose: () => void
  onResolved: (path: string) => void
}

// Three-pane editor showing the FULL file in every pane:
//
//   ┌─────────────────── current ─────────────────┬─────────── incoming ───────────┐
//   │ shared line                                  │ shared line                    │
//   │ [highlighted conflict — current side]        │ [highlighted conflict — theirs]│
//   │ shared line                                  │ shared line                    │
//   ├──────────────────────────────────────────────┴────────────────────────────────┤
//   │ Resolved (editable textarea — full file content)                              │
//   └───────────────────────────────────────────────────────────────────────────────┘
//
// Side panes are read-only annotated views. Conflict regions are highlighted
// so the user can see exactly what differs. Clicking a line inserts it into
// the resolved textarea at the cursor — letting the user cherry-pick across
// conflicts without losing the rest of the file.
//
// Toolbar shortcuts replace the entire resolved buffer with one side's full
// file, so "I want all my changes" / "I want all incoming" is one click.
export const ConflictEditor: React.FC<ConflictEditorProps> = ({ filePath, onClose, onResolved }) => {
  const [file, setFile] = useState<ConflictFile | null>(null)
  const [resolved, setResolved] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [confirmMarkers, setConfirmMarkers] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const toast = useToasts()

  const lang = useMemo(() => resolveLanguage(filePath), [filePath])

  // Per-line views of each side. `isConflict` marks lines that came from a
  // conflict block — used to highlight them in the side panes. `html` is the
  // per-line syntax-highlighted fragment (or HTML-escaped plain text when no
  // language matched), pre-computed once per pane so we can hand it straight
  // to SidePane.
  type Pane = { lines: { text: string; isConflict: boolean; html: string }[]; fullText: string }
  const panes = useMemo<{ current: Pane; incoming: Pane }>(() => {
    if (!file) return { current: { lines: [], fullText: '' }, incoming: { lines: [], fullText: '' } }
    const curText: { text: string; isConflict: boolean }[] = []
    const incText: { text: string; isConflict: boolean }[] = []
    for (const s of file.sections) {
      if (s.kind === 'shared') {
        for (const t of s.text.split('\n')) {
          curText.push({ text: t, isConflict: false })
          incText.push({ text: t, isConflict: false })
        }
      } else {
        for (const t of s.current.split('\n')) curText.push({ text: t, isConflict: true })
        for (const t of s.incoming.split('\n')) incText.push({ text: t, isConflict: true })
      }
    }
    const curFull = curText.map(l => l.text).join('\n')
    const incFull = incText.map(l => l.text).join('\n')
    const curHtml = highlightLines(curFull, lang)
    const incHtml = highlightLines(incFull, lang)
    const cur = curText.map((l, i) => ({ ...l, html: curHtml[i] ?? '' }))
    const inc = incText.map((l, i) => ({ ...l, html: incHtml[i] ?? '' }))
    return {
      current:  { lines: cur, fullText: curFull },
      incoming: { lines: inc, fullText: incFull },
    }
  }, [file, lang])

  useEffect(() => {
    let cancel = false
    window.gitApi.getConflictFile(filePath).then((f) => {
      if (cancel) return
      setFile(f)
      // Seed the resolved textarea with the current side's full file. Gives
      // the user a working baseline; they can swap to incoming or hand-edit.
      const seed = f.sections.map((s) => s.kind === 'shared' ? s.text : s.current).join('\n')
      setResolved(seed)
    })
    return () => { cancel = true }
  }, [filePath])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLTextAreaElement)) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Insert clicked-line text into the resolved textarea at the current cursor.
  // Each insertion ends with a newline so successive clicks build up cleanly.
  const insertAtCursor = useCallback((line: string) => {
    const el = textareaRef.current
    if (!el) { setResolved((r) => r + (r.endsWith('\n') ? '' : '\n') + line + '\n'); return }
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    const before = el.value.slice(0, start)
    const after = el.value.slice(end)
    const insert = line + '\n'
    const next = before + insert + after
    setResolved(next)
    // Restore selection just after the inserted text. Defer until after React
    // applies the new value, otherwise the assignment is clobbered.
    queueMicrotask(() => {
      el.focus()
      const pos = start + insert.length
      el.setSelectionRange(pos, pos)
    })
  }, [])

  const hasMarkers = resolved.includes('<<<<<<<') || resolved.includes('=======') || resolved.includes('>>>>>>>')

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

  if (!file) return <div className="ce-loading">Loading conflict file…</div>

  const conflictCount = file.sections.filter(s => s.kind === 'conflict').length

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
        <button className="ce-action" onClick={() => setResolved(panes.current.fullText)}><Icon name="arrow-left" size={12} /> Take all current</button>
        <button className="ce-action" onClick={() => setResolved(panes.incoming.fullText)}>Take all incoming <Icon name="arrow-right" size={12} /></button>
        <div style={{ flex: 1 }} />
        {hasMarkers && <span className="ce-warning"><Icon name="warning" size={12} /> Conflict markers still present</span>}
      </div>

      <div className="ce-body">
        <SyncedPanes
          currentLines={panes.current.lines}
          incomingLines={panes.incoming.lines}
          currentLabel={firstConflictLabel(file, 'current')}
          incomingLabel={firstConflictLabel(file, 'incoming')}
          onLineClick={insertAtCursor}
          resolved={resolved}
          onResolvedChange={setResolved}
          textareaRef={textareaRef}
        />
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

// Pull the first conflict block's label for header display. All blocks in a
// file share the same labels (HEAD vs the incoming branch / commit), so the
// first is representative.
function firstConflictLabel(file: ConflictFile, side: 'current' | 'incoming'): string {
  for (const s of file.sections) {
    if (s.kind === 'conflict') return side === 'current' ? s.currentLabel : s.incomingLabel
  }
  return side
}

function SyncedPanes({
  currentLines,
  incomingLines,
  currentLabel,
  incomingLabel,
  onLineClick,
  resolved,
  onResolvedChange,
  textareaRef,
}: {
  currentLines: { text: string; isConflict: boolean; html: string }[]
  incomingLines: { text: string; isConflict: boolean; html: string }[]
  currentLabel: string
  incomingLabel: string
  onLineClick: (line: string) => void
  resolved: string
  onResolvedChange: (text: string) => void
  textareaRef: React.RefObject<HTMLTextAreaElement>
}) {
  const currentRef = useRef<HTMLDivElement>(null)
  const incomingRef = useRef<HTMLDivElement>(null)
  // Guard to break the scroll feedback loop between the two top panes.
  const syncing = useRef(false)

  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to) return
    if (syncing.current) { syncing.current = false; return }
    if (to.scrollTop !== from.scrollTop || to.scrollLeft !== from.scrollLeft) {
      syncing.current = true
      to.scrollTop = from.scrollTop
      to.scrollLeft = from.scrollLeft
    }
  }

  return (
    <div className="ce-grid">
      <div className="ce-top-row">
        <SidePane
          label={`Current · ${currentLabel}`}
          kind="current"
          lines={currentLines}
          onLineClick={onLineClick}
          scrollRef={currentRef}
          onScroll={() => sync(currentRef.current, incomingRef.current)}
        />
        <SidePane
          label={`Incoming · ${incomingLabel}`}
          kind="incoming"
          lines={incomingLines}
          onLineClick={onLineClick}
          scrollRef={incomingRef}
          onScroll={() => sync(incomingRef.current, currentRef.current)}
        />
      </div>
      <div className="ce-bottom-row">
        <div className="ce-pane ce-pane-mid">
          <div className="ce-pane-head">Resolved (editable — full file)</div>
          <textarea
            ref={textareaRef}
            className="ce-textarea mono"
            value={resolved}
            onChange={(e) => onResolvedChange(e.target.value)}
            placeholder="The resolved file content. Edit freely; click highlighted lines in the side panes to insert at the cursor."
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  )
}

function SidePane({ label, kind, lines, onLineClick, scrollRef, onScroll }: {
  label: string
  kind: 'current' | 'incoming'
  lines: { text: string; isConflict: boolean; html: string }[]
  onLineClick: (line: string) => void
  scrollRef?: React.RefObject<HTMLDivElement>
  onScroll?: () => void
}) {
  return (
    <div className={`ce-pane ce-pane-${kind}`}>
      <div className="ce-pane-head">{label}</div>
      <div className="ce-pane-body mono" ref={scrollRef} onScroll={onScroll}>
        {lines.map((l, i) => (
          <button
            key={i}
            className={`ce-side-line ${l.isConflict ? 'ce-side-line-conflict' : ''}`}
            onClick={() => onLineClick(l.text)}
            title="Click to insert this line at the cursor in the resolved editor"
          >
            <span className="ce-side-lineno">{i + 1}</span>
            {l.text === ''
              ? <span className="ce-side-text">​</span>
              : <span className="ce-side-text hljs" dangerouslySetInnerHTML={{ __html: l.html }} />}
          </button>
        ))}
      </div>
    </div>
  )
}
