import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { RepoStatus, FileChange } from '../../../preload/index'
import './WorkingTree.css'

interface WorkingTreeProps {
  repoPath: string | null
  onCommitted: () => void
  onSelectDiff: (path: string, staged: boolean) => void
}

export const WorkingTree: React.FC<WorkingTreeProps> = ({ repoPath, onCommitted, onSelectDiff }) => {
  const [status, setStatus]           = useState<RepoStatus | null>(null)
  const [loading, setLoading]         = useState(false)
  const [message, setMessage]         = useState('')
  const [committing, setCommitting]   = useState(false)
  const [selectedDiff, setSelectedDiff] = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)

  // Drag-to-resize: top section height as a percentage (default 50%)
  const [splitPct, setSplitPct] = useState(50)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const refresh = useCallback(async () => {
    if (!repoPath) return
    setLoading(true)
    try {
      const s = await window.gitApi.getStatus()
      setStatus(s)
    } finally { setLoading(false) }
  }, [repoPath])

  // Silent refresh — no loading spinner, used after stage/unstage
  const silentRefresh = useCallback(async () => {
    if (!repoPath) return
    const s = await window.gitApi.getStatus()
    if (s) setStatus(s)
  }, [repoPath])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (!repoPath) return
    const unsub = window.gitApi.onGitignoreChanged(() => refresh())
    return unsub
  }, [repoPath, refresh])

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
  const handleStage   = async (files: string[]) => { await window.gitApi.stage(files);   await silentRefresh() }
  const handleUnstage = async (files: string[]) => { await window.gitApi.unstage(files); await silentRefresh() }
  const handleStageAll = async () => {
    if (!status) return
    const files = [...status.unstaged.map(f => f.path), ...status.untracked]
    if (files.length) await handleStage(files)
  }
  const handleCommit = async () => {
    if (!message.trim()) { setError('Commit message required'); return }
    setCommitting(true); setError(null)
    try {
      const result = await window.gitApi.commit(message.trim())
      if (result.success) { setMessage(''); await refresh(); onCommitted() }
      else setError(result.error || 'Commit failed')
    } finally { setCommitting(false) }
  }

  const stagedCount   = status?.staged.length ?? 0
  const unstagedCount = (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0)

  const statusLabel: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', '?': 'Untracked' }
  const statusColor: Record<string, string> = {
    M: '#f6ad55', A: '#68d391', D: '#fc8181', R: '#b794f4', '?': '#8b949e',
  }

  return (
    <div className="working-tree" ref={containerRef}>

      {/* ── Top: Unstaged ────────────────────────────── */}
      <div className="wt-section" style={{ height: `${splitPct}%` }}>
        <div className="wt-section-header">
          <span className="wt-section-title">
            Changes {unstagedCount > 0 && <span className="wt-count">{unstagedCount}</span>}
          </span>
          {unstagedCount > 0 && (
            <button className="wt-header-btn" onClick={handleStageAll}>Stage all ↓</button>
          )}
          <button className="wt-refresh-btn" onClick={refresh} title="Refresh">⟳</button>
        </div>
        <div className="wt-files">
          {loading && <div className="wt-loading">Loading…</div>}
          {unstagedCount === 0 && !loading && <div className="wt-empty">Working tree clean</div>}
          {status?.unstaged.map((f) => {
            const isUntracked = f.status === '?'
            return (
              <FileRow key={f.path} file={f}
                statusCode={f.status}
                label={statusLabel[f.status] ?? (isUntracked ? 'Untracked' : 'Unknown')}
                color={statusColor[f.status] ?? (isUntracked ? '#68d391' : '#8b949e')}
                actionIcon="↓"
                onAction={() => handleStage([f.path])}
                onSelect={() => onSelectDiff(f.path, false)}
              />
            )
          })}
          {status?.untracked.map((path) => (
            <FileRow key={path} file={{ path, status: '?' }}
              statusCode="?" label="Untracked" color="#68d391" actionIcon="↓"
              onAction={() => handleStage([path])}
              onSelect={() => onSelectDiff(path, false)}
            />
          ))}
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
          {status?.staged.map((f) => (
            <FileRow key={f.path} file={f}
              statusCode={f.status} label={statusLabel[f.status] ?? 'Unknown'} color={statusColor[f.status] ?? '#8b949e'}
              actionIcon="↑"
              onAction={() => handleUnstage([f.path])}
              onSelect={() => onSelectDiff(f.path, true)}
            />
          ))}
        </div>
      </div>

      <div className="divider" />

      {/* ── Commit box — always visible ───────────────── */}
      <div className="wt-commit">
        <textarea
          className="wt-commit-msg"
          placeholder="Commit message…"
          value={message}
          onChange={(e) => { setMessage(e.target.value); setError(null) }}
          rows={3}
        />
        {error && <div className="wt-error">{error}</div>}
        <button
          className="btn btn-primary wt-commit-btn"
          onClick={handleCommit}
          disabled={committing || !message.trim() || stagedCount === 0}
        >
          {committing ? 'Committing…' : `Commit to ${status?.branch ?? 'branch'}`}
        </button>
      </div>
    </div>
  )
}

// ── FileRow ───────────────────────────────────────────────────────────────────

function FileRow({ file, statusCode, label, color, actionIcon, onAction, selected, onSelect }: {
  file: FileChange
  statusCode: string
  label: string
  color: string
  actionIcon: string
  onAction: () => void
  selected?: boolean
  onSelect: () => void
}) {
  return (
    <div className={`wt-file-row ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <FileStatusIcon status={statusCode} color={color} label={label} />
      <span className="wt-file-path truncate" title={file.path}>{file.path}</span>
      
      {(typeof file.add === 'number' || typeof file.del === 'number') && (
        <span className="wt-file-stats">
          {file.add ? <span className="wt-stat-add">+{file.add}</span> : null}
          {file.del ? <span className="wt-stat-del">-{file.del}</span> : null}
        </span>
      )}

      <button
        className="wt-file-action"
        onClick={(e) => { e.stopPropagation(); onAction() }}
        title={actionIcon === '↓' ? 'Stage' : 'Unstage'}
      >
        {actionIcon}
      </button>
    </div>
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
