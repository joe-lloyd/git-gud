import React, { useEffect, useMemo, useState } from 'react'
import type { CommitNode } from '../../../preload/index'
import './MultiSelectDetail.css'

interface MultiSelectDetailProps {
  /** Op-eligible selected SHAs (real commits only). */
  shas: string[]
  /** Displayed commits (newest first) — used for lookup + ordering. */
  commits: CommitNode[]
  contiguous: boolean
  onSquash: () => void
  onCherryPick: () => void
  onRevert: () => void
  onDrop: () => void
  onCopyShas: () => void
  onClear: () => void
  onSelectOne: (sha: string) => void
}

// Right-panel view shown when 2+ commits are selected in the graph. Surfaces
// what's selected (count, authors, span, combined diffstat) and the bulk
// actions valid for the selection.
export const MultiSelectDetail: React.FC<MultiSelectDetailProps> = ({
  shas, commits, contiguous, onSquash, onCherryPick, onRevert, onDrop, onCopyShas, onClear, onSelectOne,
}) => {
  const bySha = useMemo(() => new Map(commits.map(c => [c.sha, c])), [commits])
  const idxOf = (sha: string) => commits.findIndex(c => c.sha === sha)

  // Selected commits in displayed (newest-first) order.
  const selected = useMemo(
    () => [...shas].sort((a, b) => idxOf(a) - idxOf(b)).map(s => bySha.get(s)).filter(Boolean) as CommitNode[],
    [shas, bySha, commits],
  )

  const authors = useMemo(() => Array.from(new Set(selected.map(c => c.author))).filter(Boolean), [selected])

  // Combined diffstat for contiguous ranges (oldest..newest).
  const [stat, setStat] = useState<{ files: number; insertions: number; deletions: number } | null>(null)
  useEffect(() => {
    setStat(null)
    if (!contiguous || selected.length < 1) return
    const newest = selected[0].sha               // newest = first in display order
    const oldest = selected[selected.length - 1].sha
    let live = true
    window.gitApi.rangeStat(oldest, newest).then((s) => { if (live) setStat(s) }).catch(() => {})
    return () => { live = false }
  }, [contiguous, selected])

  return (
    <div className="msd">
      <div className="msd-header">
        <div className="msd-count">{shas.length} commits selected</div>
        <span className={`msd-badge ${contiguous ? 'ok' : 'warn'}`}>
          {contiguous ? 'adjacent' : 'has gaps'}
        </span>
      </div>

      <div className="msd-meta">
        <span>{authors.length} author{authors.length === 1 ? '' : 's'}</span>
        {stat && (
          <span className="msd-stat">
            {stat.files} file{stat.files === 1 ? '' : 's'}
            {stat.insertions > 0 && <span className="msd-add"> +{stat.insertions}</span>}
            {stat.deletions > 0 && <span className="msd-del"> −{stat.deletions}</span>}
          </span>
        )}
        {!contiguous && <span className="msd-hint">Squash/Drop need an adjacent run</span>}
      </div>

      {/* Bulk actions */}
      <div className="msd-actions">
        <button className="btn btn-primary" disabled={!contiguous} onClick={onSquash} title={contiguous ? 'Combine into one commit' : 'Selection must be adjacent'}>⊞ Squash</button>
        <button className="btn btn-ghost" onClick={onCherryPick} title="Apply onto current branch">⊕ Cherry-pick</button>
        <button className="btn btn-ghost" onClick={onRevert} title="Revert on current branch">↶ Revert</button>
        <button className="btn btn-danger" disabled={!contiguous} onClick={onDrop} title={contiguous ? 'Remove from history' : 'Selection must be adjacent'}>🗑 Drop</button>
      </div>
      <div className="msd-actions msd-actions-sub">
        <button className="btn btn-ghost" onClick={onCopyShas}>⧉ Copy SHAs</button>
        <button className="btn btn-ghost" onClick={onClear}>✕ Clear</button>
      </div>

      {/* Selected commit list */}
      <div className="msd-list">
        {selected.map((c) => (
          <button key={c.sha} className="msd-row" onClick={() => onSelectOne(c.sha)} title={c.message}>
            <span className="msd-sha mono">{c.shortSha}</span>
            <span className="msd-msg">{c.message.split('\n')[0]}</span>
            <span className="msd-author">{c.author}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
