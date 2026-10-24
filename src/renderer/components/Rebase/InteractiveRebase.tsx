import React, { useState, useCallback, useEffect } from 'react'
import { Icon } from '../Icons/Icon'
import './InteractiveRebase.css'

interface RebaseCommit {
  sha: string
  shortSha: string
  message: string
  action: 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'
}

interface InteractiveRebaseProps {
  /** The oldest commit to rewrite; everything after it on the current branch comes too. */
  fromSha: string
  onClose: () => void
  /** Called with git's answer once the rebase ran (or stopped on a conflict). */
  onDone: (result: { success: boolean; error?: string; conflict?: boolean }) => void
}

const ACTIONS: RebaseCommit['action'][] = ['pick', 'reword', 'squash', 'fixup', 'drop']
const ACTION_COLORS: Record<RebaseCommit['action'], string> = {
  pick:   'var(--lane-0)',
  reword: 'var(--lane-2)',
  squash: 'var(--lane-4)',
  fixup:  'var(--lane-5)',
  drop:   'var(--danger)',
}
const ACTION_DESC: Record<RebaseCommit['action'], string> = {
  pick:   'Use commit as-is',
  reword: 'Use commit, but edit the message',
  squash: 'Meld into previous commit',
  fixup:  'Meld into previous commit, discard message',
  drop:   'Remove this commit',
}

export const InteractiveRebase: React.FC<InteractiveRebaseProps> = ({ fromSha, onClose, onDone }) => {
  const [items, setItems] = useState<RebaseCommit[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    window.gitApi.getRebaseCommits(fromSha).then((r) => {
      if (!live) return
      if (r.commits) setItems(r.commits.map((c) => ({ ...c, action: 'pick' })))
      else setLoadError(r.error ?? 'Could not list the commits to rebase.')
    })
    return () => { live = false }
  }, [fromSha])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [rewordTarget, setRewordTarget] = useState<number | null>(null)
  const [rewordMsg, setRewordMsg] = useState('')

  const setAction = (idx: number, action: RebaseCommit['action']) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, action } : it)))
  }

  const handleDragStart = (idx: number) => setDragIdx(idx)
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    setOverIdx(idx)
  }
  const handleDrop = useCallback((toIdx: number) => {
    if (dragIdx === null || dragIdx === toIdx) { setDragIdx(null); setOverIdx(null); return }
    setItems((prev) => {
      const next = [...prev]
      const [moved] = next.splice(dragIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
    setDragIdx(null)
    setOverIdx(null)
  }, [dragIdx])

  const startReword = (idx: number) => {
    setRewordTarget(idx)
    setRewordMsg(items[idx].message)
  }
  const confirmReword = () => {
    if (rewordTarget === null) return
    setItems((prev) => prev.map((it, i) =>
      i === rewordTarget ? { ...it, message: rewordMsg, action: 'reword' } : it
    ))
    setRewordTarget(null)
  }

  const handleApply = async () => {
    setIsRunning(true)
    const result = await window.gitApi.interactiveRebase(
      items.map(({ sha, action, message }) => (action === 'reword' ? { sha, action, message } : { sha, action })),
    )
    setIsRunning(false)
    onDone(result)
  }

  return (
    <div className="ir-overlay">
      <div className="ir-panel fade-in">
        <div className="ir-header">
          <h2>Interactive Rebase</h2>
          <p className="ir-hint">Drag to reorder · Click action to cycle · Double-click message to reword</p>
          <button className="ir-close" onClick={onClose}><Icon name="x" size={13} /></button>
        </div>

        <div className="ir-body">
          {loadError && <div className="ir-error">{loadError}</div>}
          {items.map((item, idx) => (
            <div
              key={item.sha}
              className={`ir-row ${dragIdx === idx ? 'dragging' : ''} ${overIdx === idx ? 'drop-target' : ''}`}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={() => handleDrop(idx)}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
            >
              <div className="ir-drag-handle">⠿</div>

              <button
                className="ir-action"
                style={{ backgroundColor: `${ACTION_COLORS[item.action]}22`, color: ACTION_COLORS[item.action], borderColor: `${ACTION_COLORS[item.action]}44` }}
                title={ACTION_DESC[item.action]}
                onClick={() => {
                  const next = ACTIONS[(ACTIONS.indexOf(item.action) + 1) % ACTIONS.length]
                  setAction(idx, next)
                }}
              >
                {item.action}
              </button>

              <span className="ir-sha mono">{item.shortSha}</span>

              {rewordTarget === idx ? (
                <input
                  className="ir-msg-input"
                  value={rewordMsg}
                  autoFocus
                  onChange={(e) => setRewordMsg(e.target.value)}
                  onBlur={confirmReword}
                  onKeyDown={(e) => { if (e.key === 'Enter') confirmReword(); if (e.key === 'Escape') setRewordTarget(null) }}
                />
              ) : (
                <span
                  className={`ir-msg ${item.action === 'drop' ? 'dropped' : ''}`}
                  onDoubleClick={() => startReword(idx)}
                  title="Double-click to reword"
                >
                  {item.message}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="ir-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply} disabled={isRunning || items.length === 0}>
            {isRunning ? 'Applying…' : 'Start Rebase'}
          </button>
        </div>
      </div>
    </div>
  )
}
