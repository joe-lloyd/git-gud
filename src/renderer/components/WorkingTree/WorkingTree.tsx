import React, { useState, useCallback, useRef } from 'react'
import type { RepoStatus, FileChange } from '../../../preload/index'
import './WorkingTree.css'

interface WorkingTreeProps {
  repoPath: string | null
  // Live status from App.tsx (`repo.status`) — same object the rest of the UI
  // sees, so chunk-stage from the center-pane diff updates this panel.
  status: RepoStatus | null
  // Trigger an app-wide refresh after a git mutation.
  onRefresh: () => void
  onCommitted: () => void
  onSelectDiff: (path: string, staged: boolean) => void
}

export const WorkingTree: React.FC<WorkingTreeProps> = ({ repoPath, status, onRefresh, onCommitted, onSelectDiff }) => {
  // Split commit message — subject + (optional) body, the convention git
  // expects. Subject becomes the first `-m`, body the second.
  const [subject, setSubject]         = useState('')
  const [body, setBody]               = useState('')
  const [noVerify, setNoVerify]       = useState(false)
  const [signoff, setSignoff]         = useState(false)
  const [committing, setCommitting]   = useState(false)
  const [error, setError]             = useState<string | null>(null)
  // Amend mode pre-fills HEAD's message and changes the submit op to
  // `commit --amend`. Stashed previous draft so toggling back restores it.
  const [amend, setAmend] = useState(false)
  const [draftBeforeAmend, setDraftBeforeAmend] = useState<{ subject: string; body: string }>({ subject: '', body: '' })
  // Single sequential focus index across [unstaged..., untracked..., staged...]
  // so arrow keys walk the full list regardless of section.
  const [focusedIdx, setFocusedIdx] = useState(0)
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([])

  // Drag-to-resize: top section height as a percentage (default 50%)
  const [splitPct, setSplitPct] = useState(50)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const loading = false

  // ── Resize handle drag ────────────────────────────────────────────
  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((ev.clientY - rect.top) / rect.height) * 100
      setSplitPct(Math.min(Math.max(pct, 20), 75)) // clamp 20%–75%
    }
    const onUp = () => { dragging.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // ── Git ops ───────────────────────────────────────────────────────
  // Mutations call onRefresh so App-level status updates and all consumers
  // (this panel + graph + sidebar) see the new state.
  const handleStage   = async (files: string[]) => {
    const r = await window.gitApi.stage(files)
    if (!r.success) setError(r.error)
    onRefresh()
  }
  const handleUnstage = async (files: string[]) => {
    const r = await window.gitApi.unstage(files)
    if (!r.success) setError(r.error)
    onRefresh()
  }
  const handleStageAll = async () => {
    if (!status) return
    const files = [...status.unstaged.map(f => f.path), ...status.untracked]
    if (files.length) await handleStage(files)
  }
  const handleCommit = async () => {
    if (!subject.trim()) { setError('Subject required'); return }
    setCommitting(true); setError(null)
    try {
      const opts = { subject: subject.trim(), body: body.trim(), noVerify, signoff }
      const result = amend
        ? await window.gitApi.commitAmend(opts)
        : await window.gitApi.commit(opts)
      if (result.success) {
        setSubject(''); setBody('')
        setNoVerify(false); setSignoff(false)
        setAmend(false)
        setDraftBeforeAmend({ subject: '', body: '' })
        onRefresh()
        onCommitted()
      } else setError(result.error)
    } finally { setCommitting(false) }
  }

  // Toggle amend: ON → save draft, pull HEAD's message, split into subject/body.
  //               OFF → restore the draft we had before toggling.
  const toggleAmend = useCallback(async (next: boolean) => {
    if (next === amend) return
    if (next) {
      setDraftBeforeAmend({ subject, body })
      try {
        const full = await window.gitApi.getCommitMessage()
        if (full) {
          // Subject = first line. Body = everything after the first blank line
          // (or after the first line if there's no blank separator).
          const lines = full.split('\n')
          const sep = lines.findIndex((l, i) => i > 0 && l.trim() === '')
          setSubject(lines[0] ?? '')
          setBody(sep >= 0 ? lines.slice(sep + 1).join('\n') : lines.slice(1).join('\n'))
        }
      } catch { /* leave fields untouched if log read fails */ }
      setAmend(true)
    } else {
      setAmend(false)
      setSubject(draftBeforeAmend.subject)
      setBody(draftBeforeAmend.body)
      setDraftBeforeAmend({ subject: '', body: '' })
    }
  }, [amend, subject, body, draftBeforeAmend])

  const stagedCount   = status?.staged.length ?? 0
  const unstagedCount = (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0)

  // Flatten the three lists into one sequence the keyboard handler can walk.
  // Each entry knows its source so Space/d can apply the right git op.
  type Row = { key: string; file: FileChange; staged: boolean; isUntracked: boolean }
  const rows: Row[] = []
  status?.unstaged.forEach((f) => rows.push({ key: `u:${f.path}`, file: f, staged: false, isUntracked: false }))
  status?.untracked.forEach((p) => rows.push({ key: `t:${p}`, file: { path: p, status: '?' }, staged: false, isUntracked: true }))
  status?.staged.forEach((f) => rows.push({ key: `s:${f.path}`, file: f, staged: true, isUntracked: false }))

  // Discard reverts the working tree (and index if staged) back to HEAD for
  // that file. Two-step confirm via the same path: window.confirm keeps the
  // surface area small for now — destructive enough that a prompt is right.
  const handleDiscard = useCallback(async (row: Row) => {
    const label = row.staged ? 'discard staged + working changes' : 'discard changes'
    if (!window.confirm(`${label} for ${row.file.path}?\n\nThis cannot be undone.`)) return
    if (row.isUntracked) {
      const r = await window.gitApi.discardUntracked([row.file.path])
      if (!r.success) setError(r.error)
    } else {
      const r = await window.gitApi.discardChanges([row.file.path], { staged: row.staged })
      if (!r.success) setError(r.error)
    }
    onRefresh()
  }, [onRefresh])

  // Arrow keys + Enter only — Space and letter shortcuts ate keystrokes when
  // focus was in the commit textarea. Stage / discard live on the row buttons
  // instead. Skip the handler entirely when focus is in any editable element
  // so typing always wins.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (rows.length === 0) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    const focusRow = (idx: number) => {
      const clamped = Math.max(0, Math.min(rows.length - 1, idx))
      setFocusedIdx(clamped)
      rowRefs.current[clamped]?.focus()
      const r = rows[clamped]
      if (r) onSelectDiff(r.file.path, r.staged)
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(focusedIdx + 1); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); focusRow(focusedIdx - 1); return }
    if (e.key === 'Home')      { e.preventDefault(); focusRow(0); return }
    if (e.key === 'End')       { e.preventDefault(); focusRow(rows.length - 1); return }
    const cur = rows[focusedIdx]
    if (!cur) return
    if (e.key === 'Enter')     { e.preventDefault(); onSelectDiff(cur.file.path, cur.staged); return }
  }, [rows, focusedIdx, onSelectDiff])

  const statusLabel: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', '?': 'Untracked' }
  const statusColor: Record<string, string> = {
    M: '#f6ad55', A: '#68d391', D: '#fc8181', R: '#b794f4', '?': '#8b949e',
  }

  rowRefs.current.length = rows.length

  return (
    <div
      className="working-tree"
      ref={containerRef}
      onKeyDown={handleKeyDown}
      title=""
    >

      {/* ── Top: Unstaged ────────────────────────────── */}
      <div className="wt-section" style={{ height: `${splitPct}%` }}>
        <div className="wt-section-header">
          <span className="wt-section-title">
            Changes {unstagedCount > 0 && <span className="wt-count">{unstagedCount}</span>}
          </span>
          {unstagedCount > 0 && (
            <button className="wt-header-btn" onClick={handleStageAll}>Stage all ↓</button>
          )}
          <button className="wt-refresh-btn" onClick={onRefresh} title="Refresh">⟳</button>
        </div>
        <div className="wt-files">
          {loading && <div className="wt-loading">Loading…</div>}
          {unstagedCount === 0 && !loading && <div className="wt-empty">Working tree clean</div>}
          {rows.map((r, idx) => !r.staged ? (
            <FileRow
              key={r.key}
              file={r.file}
              rowRef={(el) => { rowRefs.current[idx] = el }}
              focused={focusedIdx === idx}
              statusCode={r.file.status}
              label={statusLabel[r.file.status] ?? (r.isUntracked ? 'Untracked' : 'Unknown')}
              color={statusColor[r.file.status] ?? (r.isUntracked ? '#68d391' : '#8b949e')}
              actionIcon="↓"
              onAction={() => handleStage([r.file.path])}
              onDiscard={() => handleDiscard(r)}
              onSelect={() => { setFocusedIdx(idx); onSelectDiff(r.file.path, false) }}
            />
          ) : null)}
        </div>
      </div>

      {/* ── Drag handle ──────────────────────────────── */}
      <div className="wt-resize-handle" onMouseDown={startDrag}>
        <div className="wt-resize-grip" />
      </div>

      {/* ── Bottom: Staged ───────────────────────────── */}
      <div className="wt-section" style={{ flex: 1 }}>
        <div className="wt-section-header">
          <span className="wt-section-title">
            Staged {stagedCount > 0 && <span className="wt-count">{stagedCount}</span>}
          </span>
          {stagedCount > 0 && (
            <button className="wt-header-btn"
              onClick={() => status && handleUnstage(status.staged.map(f => f.path))}>
              Unstage all ↑
            </button>
          )}
        </div>
        <div className="wt-files">
          {stagedCount === 0 && !loading && <div className="wt-empty">Nothing staged</div>}
          {rows.map((r, idx) => r.staged ? (
            <FileRow
              key={r.key}
              file={r.file}
              rowRef={(el) => { rowRefs.current[idx] = el }}
              focused={focusedIdx === idx}
              statusCode={r.file.status} label={statusLabel[r.file.status] ?? 'Unknown'} color={statusColor[r.file.status] ?? '#8b949e'}
              actionIcon="↑"
              onAction={() => handleUnstage([r.file.path])}
              onDiscard={() => handleDiscard(r)}
              onSelect={() => { setFocusedIdx(idx); onSelectDiff(r.file.path, true) }}
            />
          ) : null)}
        </div>
      </div>

      <div className="divider" />

      {/* ── Commit box — always visible ───────────────── */}
      <div className="wt-commit">
        <label className="wt-amend-toggle">
          <input
            type="checkbox"
            checked={amend}
            onChange={(e) => toggleAmend(e.target.checked)}
          />
          <span>Amend last commit</span>
        </label>
        {amend && (status?.ahead ?? 0) === 0 && (
          <div className="wt-amend-warn">
            ⚠ This commit has been pushed — amending will require force-push.
          </div>
        )}

        {/* Subject — single line. Soft warn at 50, hard warn at 72 (the
            convention: subject ≤ 50, hard cap 72). Counter changes color. */}
        <div className="wt-subject-wrap">
          <input
            type="text"
            className="wt-commit-subject"
            placeholder="Subject"
            value={subject}
            onChange={(e) => { setSubject(e.target.value); setError(null) }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleCommit() }
            }}
            maxLength={200}
          />
          <span className={`wt-subject-count ${subject.length > 72 ? 'over' : subject.length > 50 ? 'warn' : ''}`}>
            {subject.length}/50
          </span>
        </div>

        <textarea
          className="wt-commit-body"
          placeholder="Description (optional)"
          value={body}
          onChange={(e) => { setBody(e.target.value); setError(null) }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleCommit() }
          }}
          rows={3}
        />

        <div className="wt-commit-flags">
          <label className="wt-flag" title="Pass --no-verify; skips pre-commit and commit-msg hooks.">
            <input type="checkbox" checked={noVerify} onChange={(e) => setNoVerify(e.target.checked)} />
            <span>Skip hooks</span>
          </label>
          <label className="wt-flag" title="Pass --signoff; adds a Signed-off-by trailer.">
            <input type="checkbox" checked={signoff} onChange={(e) => setSignoff(e.target.checked)} />
            <span>Sign-off</span>
          </label>
        </div>

        {error && <div className="wt-error">{error}</div>}
        <button
          className="btn btn-primary wt-commit-btn"
          onClick={handleCommit}
          disabled={committing || !subject.trim() || (!amend && stagedCount === 0)}
        >
          {committing
            ? (amend ? 'Amending…' : 'Committing…')
            : (amend ? `Amend on ${status?.branch ?? 'branch'}` : `Commit to ${status?.branch ?? 'branch'}`)}
        </button>
      </div>
    </div>
  )
}

// ── FileRow ───────────────────────────────────────────────────────────────────

function FileRow({ file, statusCode, label, color, actionIcon, onAction, onDiscard, focused, onSelect, rowRef }: {
  file: FileChange
  statusCode: string
  label: string
  color: string
  actionIcon: string
  onAction: () => void
  onDiscard: () => void
  focused?: boolean
  onSelect: () => void
  rowRef?: (el: HTMLButtonElement | null) => void
}) {
  return (
    <button
      ref={rowRef}
      type="button"
      className={`wt-file-row ${focused ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <FileStatusIcon status={statusCode} color={color} label={label} />
      <span className="wt-file-path truncate" title={file.path}>{file.path}</span>

      {(typeof file.add === 'number' || typeof file.del === 'number') && (
        <span className="wt-file-stats">
          {file.add ? <span className="wt-stat-add">+{file.add}</span> : null}
          {file.del ? <span className="wt-stat-del">-{file.del}</span> : null}
        </span>
      )}

      <span
        className="wt-file-action wt-file-discard"
        role="button"
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); onDiscard() }}
        title="Discard"
      >
        ✗
      </span>
      <span
        className="wt-file-action"
        role="button"
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); onAction() }}
        title={actionIcon === '↓' ? 'Stage' : 'Unstage'}
      >
        {actionIcon}
      </span>
    </button>
  )
}

function FileStatusIcon({ status, color, label }: { status: string, color: string, label: string }) {
  let path = ''
  if (status === 'A') path = 'M12 4v16m8-8H4'
  else if (status === 'D') path = 'M4 12h16'
  else if (status === 'R') path = 'M13 5l7 7-7 7M5 5l7 7-7 7'
  else if (status === '?' || status === 'U') path = 'M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3m0 5h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
  else path = 'M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z' // Modified fallback

  return (
    <svg className="wt-status-svg" width="16" height="16" viewBox="0 0 24 24" 
         stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <title>{label}</title>
      <path d={path} />
    </svg>
  )
}
