import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { CommitNode } from '../../../preload/index'
import { useToasts } from '../Toast/Toast'
import { ConfirmModal } from '../AppAux/AuxComponents'
import './ReflogPanel.css'

interface ReflogPanelProps {
  repoPath: string | null
  onClose: () => void
  /** Called after a successful restore so the app can refresh. */
  onRestored: () => void
}

// Right-panel reflog browser — the recovery surface when a reset/rebase went
// wrong. Lists HEAD movements newest-first; "Restore HEAD here" resets --hard.
export const ReflogPanel: React.FC<ReflogPanelProps> = ({ repoPath, onClose, onRestored }) => {
  const toast = useToasts()
  const [entries, setEntries] = useState<CommitNode[]>([])
  const [loading, setLoading] = useState(true)
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [confirmSha, setConfirmSha] = useState<string | null>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])

  useEffect(() => {
    let live = true
    setLoading(true)
    window.gitApi.getReflog(200).then((e) => { if (live) { setEntries(e); setLoading(false) } }).catch(() => setLoading(false))
    return () => { live = false }
  }, [repoPath])

  const selector = (e: CommitNode) => e.refs.find((r) => r.includes('@{')) ?? ''

  const copySha = useCallback((sha: string) => {
    navigator.clipboard.writeText(sha).then(() => toast.success('Copied', sha.slice(0, 10))).catch(() => {})
  }, [toast])

  const doRestore = useCallback(async () => {
    const sha = confirmSha
    setConfirmSha(null)
    if (!sha) return
    const r = await window.gitApi.restoreFromReflog(sha)
    if (r.success) { toast.success('HEAD restored', sha.slice(0, 7)); onRestored() }
    else toast.error('Restore failed', r.error)
  }, [confirmSha, toast, onRestored])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (entries.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); const n = Math.min(entries.length - 1, focusedIdx + 1); setFocusedIdx(n); rowRefs.current[n]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); const n = Math.max(0, focusedIdx - 1); setFocusedIdx(n); rowRefs.current[n]?.focus() }
    else if (e.key === 'Enter') { e.preventDefault(); setConfirmSha(entries[focusedIdx]?.sha ?? null) }
    else if (e.key === 'c') { copySha(entries[focusedIdx]?.sha ?? '') }
  }

  return (
    <div className="reflog-panel" onKeyDown={onKeyDown}>
      <div className="reflog-header">
        <span className="reflog-title">Reflog</span>
        <span className="reflog-sub">HEAD history — recover lost commits</span>
        <span style={{ flex: 1 }} />
        <button className="reflog-close" onClick={onClose} title="Close">✕</button>
      </div>

      {loading ? (
        <div className="reflog-empty">Loading reflog…</div>
      ) : entries.length === 0 ? (
        <div className="reflog-empty">No reflog entries.</div>
      ) : (
        <div className="reflog-list">
          {entries.map((e, i) => (
            <div
              key={`${e.sha}-${i}`}
              ref={(el) => { rowRefs.current[i] = el }}
              tabIndex={0}
              className={`reflog-row ${focusedIdx === i ? 'focused' : ''}`}
              onClick={() => setFocusedIdx(i)}
            >
              <div className="reflog-row-top">
                <span className="reflog-sel mono">{selector(e)}</span>
                <span className="reflog-sha mono">{e.shortSha}</span>
                <span className="reflog-date">{formatRelative(e.date)}</span>
              </div>
              <div className="reflog-msg" title={e.message}>{e.message}</div>
              <div className="reflog-actions">
                <button className="reflog-btn" onClick={() => setConfirmSha(e.sha)}>Restore HEAD here</button>
                <button className="reflog-btn reflog-btn-ghost" onClick={() => copySha(e.sha)}>Copy SHA</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmSha && (
        <ConfirmModal
          title="Restore HEAD to this point?"
          message={`Reset HEAD (and the working tree) to ${confirmSha.slice(0, 7)}.`}
          detail="This will discard any commits made after this point and overwrite uncommitted changes. This cannot be undone (though the reflog keeps a record)."
          confirmLabel="Restore (reset --hard)"
          danger
          onClose={() => setConfirmSha(null)}
          onConfirm={doRestore}
        />
      )}
    </div>
  )
}

function formatRelative(iso: string): string {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`
  return `${Math.floor(s / 2592000)}mo ago`
}
