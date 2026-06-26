import React, { useEffect, useState } from 'react'
import type { WorktreeInfo } from '../../../preload/index'
import { worktreeBaseFor, defaultWorktreePath } from '../../lib/worktree-path'
import './Worktrees.css'

interface WorktreesProps {
  currentPath: string | null
  onClose: () => void
  onSwitch: (path: string) => void
}

export const Worktrees: React.FC<WorktreesProps> = ({ currentPath, onClose, onSwitch }) => {
  const [trees, setTrees] = useState<WorktreeInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [newPath, setNewPath] = useState('')
  const [newBranch, setNewBranch] = useState('')
  // Once the user hand-edits the path we stop auto-deriving it from the branch.
  const [pathEdited, setPathEdited] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Inline force-remove prompt (native window.confirm is unreliable in Electron).
  const [confirmForce, setConfirmForce] = useState<{ path: string; error: string } | null>(null)

  // Worktrees live in a sibling folder of the project: `‹project›.worktrees/`.
  const worktreeBase = worktreeBaseFor(currentPath ?? '')

  // Keep the path in sync with the branch name until the user edits it directly.
  const onBranchChange = (v: string) => {
    setNewBranch(v)
    if (!pathEdited) setNewPath(defaultWorktreePath(currentPath ?? '', v))
  }

  const load = async () => {
    setLoading(true)
    try { setTrees(await window.gitApi.getWorktrees()) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleAdd = async () => {
    if (!newPath || !newBranch) { setError('Path and branch are required'); return }
    setAdding(true); setError(null)
    try {
      const r = await window.gitApi.addWorktree(newPath, newBranch)
      if (!r.success) { setError(r.error); return }
      setNewPath(''); setNewBranch(''); setPathEdited(false)
      await load()
    } catch (e) { setError(String(e)) }
    finally { setAdding(false) }
  }

  const handleRemove = async (path: string) => {
    setError(null); setConfirmForce(null)
    const r = await window.gitApi.removeWorktree(path)
    if (r.success) { await load(); return }
    // git refuses a dirty/locked worktree without --force — show an inline
    // confirm to force it (no native window.confirm).
    setConfirmForce({ path, error: r.error })
  }

  const handleForceRemove = async () => {
    if (!confirmForce) return
    const { path } = confirmForce
    setConfirmForce(null); setError(null)
    const r = await window.gitApi.removeWorktree(path, true)
    if (!r.success) setError(r.error)
    await load()
  }

  const handleSwitch = async (path: string) => {
    const ok = await window.gitApi.openPath(path)
    if (ok) { onSwitch(path); onClose() }
    else setError(`Could not open worktree at "${path}"`)
  }

  return (
    <div className="ir-overlay">
      <div className="wt-panel fade-in">
        <div className="ir-header">
          <h2>Worktrees</h2>
          <span style={{ flex: 1 }} />
          <button className="ir-close" onClick={onClose}>✕</button>
        </div>

        <div className="wtp-body">
          {confirmForce && (
            <div className="wt-error" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
              <div><strong>Couldn't remove worktree.</strong> {confirmForce.error}</div>
              <div style={{ color: 'var(--text-muted)' }}>Force-removing discards any uncommitted changes in that worktree. This cannot be undone.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-danger" style={{ fontSize: 11 }} onClick={handleForceRemove}>Force remove</button>
                <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setConfirmForce(null)}>Cancel</button>
              </div>
            </div>
          )}
          {loading ? (
            <div className="wt-empty">Loading…</div>
          ) : trees.map((t) => (
            <div key={t.path} className="wtp-row">
              <div className="wtp-info">
                <div className="wtp-branch">
                  <span className="ref-pill ref-local">{t.branch}</span>
                  {t.isMain && <span className="ref-pill ref-head">main</span>}
                  {t.path === currentPath && <span className="ref-pill ref-head">● active</span>}
                </div>
                <div className="wtp-path mono truncate" title={t.path}>{t.path}</div>
                <div className="wtp-sha mono">{t.sha.slice(0, 7)}</div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {t.path !== currentPath && (
                  <button className="btn btn-primary" style={{ fontSize: 11 }} onClick={() => handleSwitch(t.path)}>
                    Switch →
                  </button>
                )}
                {!t.isMain && (
                  <button className="btn btn-danger" style={{ fontSize: 11 }} onClick={() => handleRemove(t.path)}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className="wtp-add">
            <div className="wtp-add-title">Add Worktree</div>
            <div className="wtp-add-row">
              <input placeholder="Branch" value={newBranch} onChange={(e) => onBranchChange(e.target.value)} />
              <input
                placeholder={worktreeBase ? `${worktreeBase}/‹branch›` : 'Path (e.g. ../my-feature)'}
                value={newPath}
                onChange={(e) => { setPathEdited(true); setNewPath(e.target.value) }}
                title={newPath}
              />
              <button className="btn btn-primary" onClick={handleAdd} disabled={adding}>
                {adding ? '…' : 'Add'}
              </button>
            </div>
            {error && <div className="wt-error">{error}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
