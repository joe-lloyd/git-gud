import React, { useEffect, useState } from 'react'
import type { WorktreeInfo } from '../../../preload/index'
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
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      await window.gitApi.addWorktree(newPath, newBranch)
      setNewPath(''); setNewBranch('')
      await load()
    } catch (e) { setError(String(e)) }
    finally { setAdding(false) }
  }

  const handleRemove = async (path: string) => {
    if (!confirm(`Remove worktree at "${path}"?`)) return
    try { await window.gitApi.removeWorktree(path); await load() }
    catch (e) { setError(String(e)) }
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
              <input placeholder="Path (e.g. ../my-feature)" value={newPath} onChange={(e) => setNewPath(e.target.value)} />
              <input placeholder="Branch" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
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
