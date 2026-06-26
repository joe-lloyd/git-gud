import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { ConflictState } from '../../../preload/index'
import { useToasts } from '../Toast/Toast'
import { ConfirmModal } from '../AppAux/AuxComponents'
import './ConflictPanel.css'

interface ConflictPanelProps {
  state: ConflictState
  currentBranch: string
  onSelectDiff: (path: string) => void
  onRefresh: () => void
}

// Mid-flight rebase/merge surface. Takes over the right column while the repo
// is paused — lists unresolved files, lets the user mark them resolved (by
// staging), and offers continue/skip/abort once they're done.
//
// User resolves the actual conflict in their IDE; we don't ship an in-app
// merge editor.
export const ConflictPanel: React.FC<ConflictPanelProps> = ({ state, currentBranch, onSelectDiff, onRefresh }) => {
  const { inMerge, inRebase, rebaseKind, conflictedFiles } = state
  const mode: 'merge' | 'rebase' = inRebase ? 'rebase' : 'merge'
  const toast = useToasts()
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [confirmAbort, setConfirmAbort] = useState(false)
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([])

  // Files for which rerere has a recorded resolution in this operation (it
  // auto-reapplies them). Surface a banner so the user can forget a bad one.
  const [rerereFiles, setRerereFiles] = useState<string[]>([])
  useEffect(() => {
    let live = true
    window.gitApi.rerereStatus().then((f) => { if (live) setRerereFiles(f) }).catch(() => {})
    return () => { live = false }
  }, [conflictedFiles.length, inMerge, inRebase])

  const forgetRerere = useCallback(async () => {
    for (const f of rerereFiles) await window.gitApi.rerereForget(f)
    toast.success('rerere resolutions forgotten', `${rerereFiles.length} file${rerereFiles.length === 1 ? '' : 's'}`)
    setRerereFiles([])
    onRefresh()
  }, [rerereFiles, toast, onRefresh])

  const allResolved = conflictedFiles.length === 0

  const handleMarkResolved = useCallback(async (path: string) => {
    const r = await window.gitApi.markResolved([path])
    if (r.success) onRefresh()
    else toast.error('Mark resolved failed', r.error)
  }, [onRefresh, toast])

  const handleContinue = useCallback(async () => {
    const r = mode === 'rebase'
      ? await window.gitApi.rebaseContinue()
      : await window.gitApi.mergeContinue()
    if (r.success) { toast.success(`${mode === 'rebase' ? 'Rebase' : 'Merge'} continued`); onRefresh() }
    else toast.error('Continue failed', r.error)
  }, [mode, onRefresh, toast])

  const handleSkip = useCallback(async () => {
    const r = await window.gitApi.rebaseSkip()
    if (r.success) { toast.success('Commit skipped'); onRefresh() }
    else toast.error('Skip failed', r.error)
  }, [onRefresh, toast])

  const doAbort = useCallback(async () => {
    setConfirmAbort(false)
    const r = mode === 'rebase'
      ? await window.gitApi.rebaseAbort()
      : await window.gitApi.mergeAbort()
    if (r.success) { toast.success(`${mode === 'rebase' ? 'Rebase' : 'Merge'} aborted`); onRefresh() }
    else toast.error('Abort failed', r.error)
  }, [mode, onRefresh, toast])

  // Arrow keys + Enter only. Letter shortcuts ate keystrokes when an editable
  // element happened to be focused, so we drop them and guard the rest.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (conflictedFiles.length === 0) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    const focus = (idx: number) => {
      const clamped = Math.max(0, Math.min(conflictedFiles.length - 1, idx))
      setFocusedIdx(clamped)
      rowRefs.current[clamped]?.focus()
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); focus(focusedIdx + 1); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); focus(focusedIdx - 1); return }
    const cur = conflictedFiles[focusedIdx]
    if (!cur) return
    if (e.key === 'Enter')     { e.preventDefault(); onSelectDiff(cur); return }
  }, [conflictedFiles, focusedIdx, onSelectDiff])

  rowRefs.current.length = conflictedFiles.length

  return (
    <div className="conflict-panel" onKeyDown={handleKeyDown}>
      <div className="conflict-header">
        <div className="conflict-title">
          <span className="conflict-badge">{mode === 'rebase' ? `Rebase ${rebaseKind === 'merge' ? '(interactive)' : ''}` : 'Merge'} in progress</span>
          <div className="conflict-branch">on <span className="mono">{currentBranch}</span></div>
        </div>
      </div>

      {rerereFiles.length > 0 && (
        <div className="conflict-rerere-banner">
          <span>
            <strong>rerere</strong> reapplied a recorded resolution to {rerereFiles.length} file{rerereFiles.length === 1 ? '' : 's'}.
          </span>
          <button className="conflict-rerere-forget" onClick={forgetRerere} title="Discard the recorded resolution and restore the raw conflict">
            Forget
          </button>
        </div>
      )}

      <div className="conflict-body">
        {allResolved ? (
          <div className="conflict-resolved-banner">
            <div className="conflict-resolved-title">All conflicts resolved</div>
            <div className="conflict-resolved-sub">
              {mode === 'rebase'
                ? 'Continue to apply the next commit, or abort to return to the previous state.'
                : 'Continue to finalize the merge commit, or abort to return to the previous state.'}
            </div>
          </div>
        ) : (
          <>
            <div className="conflict-instructions">
              <strong>{conflictedFiles.length}</strong> {conflictedFiles.length === 1 ? 'file has' : 'files have'} conflicts.
              <br />
              <span className="conflict-step">1.</span> Open each file in your editor and resolve the {'<<<<<<<'} markers.
              <br />
              <span className="conflict-step">2.</span> Click <em>Mark resolved</em> to stage it.
              <br />
              <span className="conflict-step">3.</span> Continue when all files are marked resolved.
            </div>
            <div className="conflict-file-list">
              {conflictedFiles.map((path, i) => (
                <button
                  key={path}
                  ref={(el) => { rowRefs.current[i] = el }}
                  className={`conflict-file-row ${focusedIdx === i ? 'focused' : ''}`}
                  onClick={() => { setFocusedIdx(i); onSelectDiff(path) }}
                >
                  <span className="conflict-file-icon">⚠</span>
                  <span className="conflict-file-path mono truncate" title={path}>{path}</span>
                  <span
                    className="conflict-mark-btn"
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => { e.stopPropagation(); handleMarkResolved(path) }}
                    title="Mark this file as resolved (stages it)"
                  >
                    Mark resolved ✓
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="conflict-footer">
        <button className="btn btn-ghost" onClick={() => setConfirmAbort(true)}>Abort {mode}</button>
        <div style={{ flex: 1 }} />
        {mode === 'rebase' && (
          <button className="btn btn-ghost" onClick={handleSkip} title="Skip the current commit and continue rebasing">Skip commit</button>
        )}
        <button
          className="btn btn-primary"
          onClick={handleContinue}
          disabled={!allResolved}
          title={allResolved ? 'Resume the operation' : 'Resolve all files first'}
        >
          Continue {mode}
        </button>
      </div>

      {confirmAbort && (
        <ConfirmModal
          title={`Abort ${mode}?`}
          message={`Your repository will return to the state before this ${mode} started.`}
          confirmLabel={`Abort ${mode}`}
          danger
          onClose={() => setConfirmAbort(false)}
          onConfirm={doAbort}
        />
      )}
    </div>
  )
}

