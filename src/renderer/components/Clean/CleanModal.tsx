import React, { useCallback, useEffect, useState } from 'react'
import { useToasts } from '../Toast/Toast'
import './CleanModal.css'

interface CleanModalProps {
  onClose: () => void
  onCleaned: () => void
}

// `git clean` UI: pick a scope, preview the exact paths that would be removed,
// uncheck any to keep, then type "delete" to confirm (this is irreversible).
export const CleanModal: React.FC<CleanModalProps> = ({ onClose, onCleaned }) => {
  const toast = useToasts()
  const [dirs, setDirs] = useState(true)
  const [ignored, setIgnored] = useState(false)
  const [paths, setPaths] = useState<string[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)

  // (Re)load the preview whenever the scope changes.
  useEffect(() => {
    let live = true
    setLoading(true)
    window.gitApi.cleanPreview({ dirs, ignored }).then((p) => {
      if (!live) return
      setPaths(p)
      setChecked(new Set(p)) // default: all checked
      setLoading(false)
    }).catch(() => setLoading(false))
    return () => { live = false }
  }, [dirs, ignored])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggle = (p: string) => setChecked((s) => {
    const next = new Set(s)
    next.has(p) ? next.delete(p) : next.add(p)
    return next
  })

  const selected = paths.filter((p) => checked.has(p))
  const canConfirm = selected.length > 0 && confirmText.trim().toLowerCase() === 'delete' && !busy

  const run = useCallback(async () => {
    if (!canConfirm) return
    setBusy(true)
    const r = await window.gitApi.clean(selected, { dirs, ignored })
    setBusy(false)
    if (r.success) {
      toast.success('Cleaned', `${selected.length} item${selected.length === 1 ? '' : 's'} removed.`)
      onCleaned()
    } else toast.error('Clean failed', r.error)
  }, [canConfirm, selected, dirs, ignored, toast, onCleaned])

  return (
    <div className="modal-overlay clean-overlay" onClick={onClose}>
      <div className="clean-modal fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="clean-head">
          <span className="clean-title">⚠ Clean working tree</span>
          <button className="clean-close" onClick={onClose}>✕</button>
        </div>

        <div className="clean-scopes">
          <label><input type="checkbox" checked onChange={() => {}} disabled /> Untracked files</label>
          <label><input type="checkbox" checked={dirs} onChange={(e) => setDirs(e.target.checked)} /> Untracked directories</label>
          <label><input type="checkbox" checked={ignored} onChange={(e) => setIgnored(e.target.checked)} /> Ignored files</label>
        </div>

        <div className="clean-list">
          {loading ? (
            <div className="clean-empty">Scanning…</div>
          ) : paths.length === 0 ? (
            <div className="clean-empty">Nothing to clean for this scope.</div>
          ) : paths.map((p) => (
            <label key={p} className="clean-row">
              <input type="checkbox" checked={checked.has(p)} onChange={() => toggle(p)} />
              <span className="clean-path mono">{p}</span>
            </label>
          ))}
        </div>

        <div className="clean-footer">
          <div className="clean-confirm-row">
            <span className="clean-confirm-label">Type <b>delete</b> to confirm removing {selected.length} item{selected.length === 1 ? '' : 's'}:</span>
            <input
              className="clean-confirm-input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="delete"
              autoFocus
            />
          </div>
          <div className="clean-actions">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-danger" disabled={!canConfirm} onClick={run}>
              {busy ? 'Cleaning…' : `Clean ${selected.length}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
