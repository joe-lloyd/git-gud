import React, { useState, useCallback, useRef } from 'react'
import type { RepoStatus, FileChange } from '../../../preload/index'
import { ConfirmModal } from '../AppAux/AuxComponents'
import { Icon } from '../Icons/Icon'
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
  // Open the bottom console (git-activity log) for a hook-running commit.
  onCommitRun: (runId: string, command: string) => void
  // Gerrit mode: amend+re-push-for-review is the normal iteration there, so
  // the force-push warning gives way to a neutral patchset hint.
  gerritMode?: boolean
}

export const WorkingTree: React.FC<WorkingTreeProps> = ({ repoPath, status, onRefresh, onCommitted, onSelectDiff, onCommitRun, gerritMode = false }) => {
  // Split commit message — subject + (optional) body, the convention git
  // expects. Subject becomes the first `-m`, body the second.
  const [subject, setSubject]         = useState('')
  const [body, setBody]               = useState('')
  const [noVerify, setNoVerify]       = useState(false)
  const [signoff, setSignoff]         = useState(false)
  const [committing, setCommitting]   = useState(false)
  const [error, setError]             = useState<string | null>(null)
  // Pending discard awaiting in-app confirmation.
  const [confirmDiscard, setConfirmDiscard] = useState<{ path: string; staged: boolean; isUntracked: boolean } | null>(null)
  // A stage/unstage that hit a stale `.git/index.lock`. Holds the operation so
  // it can be re-run verbatim once the user OKs removing the lock.
  const [lockedOp, setLockedOp] = useState<{ label: string; retry: () => Promise<void> } | null>(null)
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
  // A crashed git process leaves `.git/index.lock` behind and every subsequent
  // index write fails with a fatal the user can't clear from here. Park the
  // operation and offer to remove the lock rather than dead-ending them.
  const runIndexOp = async (label: string, op: () => Promise<{ success: boolean; error?: string; indexLocked?: boolean }>) => {
    const r = await op()
    if (!r.success) {
      if (r.indexLocked) setLockedOp({ label, retry: async () => { await runIndexOp(label, op) } })
      else setError(r.error ?? `${label} failed`)
    }
    onRefresh()
  }

  const handleStage   = (files: string[]) =>
    runIndexOp('Stage', () => window.gitApi.stage(files))
  const handleUnstage = (files: string[]) =>
    runIndexOp('Unstage', () => window.gitApi.unstage(files))

  // Confirmed "Remove Lock & Retry" — drop the lock file, then re-run the exact
  // command that failed. A lock still held by a live process reports back as a
  // plain error instead of being force-removed.
  const removeLockAndRetry = useCallback(async (retry: () => Promise<void>) => {
    setError(null)
    const r = await window.gitApi.removeIndexLock()
    if (!r.success) { setError(r.error); onRefresh(); return }
    await retry()
  }, [onRefresh])
  const handleStageAll = async () => {
    if (!status) return
    const files = [...status.unstaged.map(f => f.path), ...status.untracked]
    if (files.length) await handleStage(files)
  }
  const handleCommit = async () => {
    if (!subject.trim()) { setError('Subject required'); return }
    setCommitting(true); setError(null)
    try {
      // Correlate this invocation with its streamed output. When hooks run
      // (i.e. not --no-verify), open the live output view so the user watches
      // pre-commit/commit-msg hooks fire instead of staring at a frozen button.
      const runId = crypto.randomUUID()
      if (!noVerify) {
        const parts = ['git', 'commit']
        if (amend) parts.push('--amend')
        if (signoff) parts.push('--signoff')
        parts.push('-m', JSON.stringify(subject.trim()))
        if (body.trim()) parts.push('-m', JSON.stringify(body.trim()))
        onCommitRun(runId, parts.join(' '))
      }
      const opts = { subject: subject.trim(), body: body.trim(), noVerify, signoff, runId }
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
      } else setError(result.error ?? 'Commit failed')
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
  // that file. Destructive, so it routes through an in-app ConfirmModal (native
  // window.confirm is unreliable in this Electron build).
  const handleDiscard = useCallback((row: Row) => {
    setConfirmDiscard({ path: row.file.path, staged: row.staged, isUntracked: row.isUntracked })
  }, [])

  const doDiscard = useCallback(async () => {
    const d = confirmDiscard
    setConfirmDiscard(null)
    if (!d) return
    if (d.isUntracked) {
      const r = await window.gitApi.discardUntracked([d.path])
      if (!r.success) setError(r.error)
    } else {
      const r = await window.gitApi.discardChanges([d.path], { staged: d.staged })
      if (!r.success) setError(r.error)
    }
    onRefresh()
  }, [confirmDiscard, onRefresh])

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
    M: '#f6ad55', A: '#68d391', D: '#fc8181', R: '#b794f4', '?': '#68d391',
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
            <button className="wt-header-btn" onClick={handleStageAll}>Stage all <Icon name="arrow-down" size={11} /></button>
          )}
          <button className="wt-refresh-btn" onClick={onRefresh} title="Refresh"><Icon name="refresh" size={12} /></button>
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
              action="stage"
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
              Unstage all <Icon name="arrow-up" size={11} />
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
              action="unstage"
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
          gerritMode ? (
            <div className="wt-amend-hint">
              <Icon name="info" size={12} /> Amending creates a new patchset when pushed for review.
            </div>
          ) : (
            <div className="wt-amend-warn">
              <Icon name="warning" size={12} /> This commit has been pushed — amending will require force-push.
            </div>
          )
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

      {confirmDiscard && (
        <ConfirmModal
          title="Discard changes?"
          message={`${confirmDiscard.staged ? 'Discard staged + working changes' : 'Discard changes'} for ${confirmDiscard.path}.`}
          detail="This reverts the file to HEAD and cannot be undone."
          confirmLabel="Discard"
          danger
          onClose={() => setConfirmDiscard(null)}
          onConfirm={doDiscard}
        />
      )}

      {lockedOp && (
        <ConfirmModal
          title="Git index is locked"
          message="A previous Git process may have crashed. Remove the lock file to continue?"
          detail={`Deletes .git/index.lock, then retries ${lockedOp.label.toLowerCase()}. Only do this if no other Git process is running.`}
          confirmLabel="Remove Lock & Retry"
          onClose={() => setLockedOp(null)}
          onConfirm={() => { void removeLockAndRetry(lockedOp.retry) }}
        />
      )}
    </div>
  )
}

// ── FileRow ───────────────────────────────────────────────────────────────────

function FileRow({ file, statusCode, label, color, action, onAction, onDiscard, focused, onSelect, rowRef }: {
  file: FileChange
  statusCode: string
  label: string
  color: string
  action: 'stage' | 'unstage'
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
      <span className="wt-file-path" title={file.path}><bdi>{file.path}</bdi></span>

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
        <Icon name="x" size={12} />
      </span>
      <span
        className="wt-file-action"
        role="button"
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); onAction() }}
        title={action === 'stage' ? 'Stage' : 'Unstage'}
      >
        <Icon name={action === 'stage' ? 'arrow-down' : 'arrow-up'} size={12} />
      </span>
    </button>
  )
}

function FileStatusIcon({ status, color, label }: { status: string, color: string, label: string }) {
  let path = ''
  // Untracked ('?') is a new file — same green + as a staged Add.
  if (status === 'A' || status === '?') path = 'M12 4v16m8-8H4'
  else if (status === 'D') path = 'M4 12h16'
  else if (status === 'R') path = 'M13 5l7 7-7 7M5 5l7 7-7 7'
  else if (status === 'U') path = 'M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3m0 5h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
  else path = 'M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z' // Modified fallback

  return (
    <svg className="wt-status-svg" width="16" height="16" viewBox="0 0 24 24" 
         stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <title>{label}</title>
      <path d={path} />
    </svg>
  )
}
