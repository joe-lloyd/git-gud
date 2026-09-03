import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { ConflictState, ConflictOp } from '../../../preload/index'
import { useToasts } from '../Toast/Toast'
import { ConfirmModal } from '../AppAux/AuxComponents'
import { Icon } from '../Icons/Icon'
import { opControls, opLabel } from '../../lib/conflictState'
import './ConflictPanel.css'

interface ConflictPanelProps {
  state: ConflictState
  currentBranch: string
  onSelectDiff: (path: string) => void
  onRefresh: () => void
}

// Paused-operation surface. Takes over the right column while the repo is
// stopped on a merge, rebase, cherry-pick, revert or stash re-apply — lists
// unresolved files, opens each in the in-app conflict editor, lets the user
// mark them resolved (by staging), and offers continue/skip/abort.
export const ConflictPanel: React.FC<ConflictPanelProps> = ({ state, currentBranch, onSelectDiff, onRefresh }) => {
  const { inMerge, inRebase, rebaseKind, conflictedFiles } = state
  const mode: ConflictOp = state.op ?? (inRebase ? 'rebase' : inMerge ? 'merge' : 'merge')
  const controls = opControls(mode)
  const label = opLabel(mode)            // "Merge", "Cherry-pick", "Stash re-apply"
  const lower = label.toLowerCase()
  const toast = useToasts()
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [confirmAbort, setConfirmAbort] = useState(false)
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([])

  // Boss-bar HP. The operation's "full health" is the most conflicts we've
  // seen at once this session (a rebase can add fresh conflicts per replayed
  // commit, so the max can grow); the unresolved files remaining are the HP
  // left. The panel unmounts when the operation ends, resetting the fight.
  const [maxConflicts, setMaxConflicts] = useState(conflictedFiles.length)
  useEffect(() => {
    setMaxConflicts((m) => Math.max(m, conflictedFiles.length))
  }, [conflictedFiles.length])
  const hpPct = maxConflicts > 0 ? (conflictedFiles.length / maxConflicts) * 100 : 0

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
    const r = await window.gitApi.opContinue(mode)
    if (r.success) { toast.success(`${label} continued`); onRefresh() }
    else toast.error('Continue failed', r.error)
  }, [mode, label, onRefresh, toast])

  const handleSkip = useCallback(async () => {
    const r = await window.gitApi.opSkip(mode)
    if (r.success) { toast.success('Commit skipped'); onRefresh() }
    else toast.error('Skip failed', r.error)
  }, [mode, onRefresh, toast])

  const doAbort = useCallback(async () => {
    setConfirmAbort(false)
    const r = await window.gitApi.opAbort(mode)
    if (r.success) {
      toast.success(`${label} aborted`, mode === 'stash' ? 'Conflicted files restored from HEAD. The stash entry is still on the stack.' : undefined)
      onRefresh()
    }
    else toast.error('Abort failed', r.error)
  }, [mode, label, onRefresh, toast])

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
        {/* Boss encounter: the conflict is the boss, unresolved files are its
            HP. Marking files resolved drains the bar; empty bar = victory. */}
        <div className="boss-name-row">
          <span className={`boss-name ${allResolved ? 'defeated' : ''}`}>
            {allResolved ? 'Victory Achieved' : `${label} Conflict`}
          </span>
          {!allResolved && (
            <span className="boss-hp-count mono">{conflictedFiles.length} / {maxConflicts}</span>
          )}
        </div>
        <div
          className="boss-bar"
          role="progressbar"
          aria-label="Unresolved conflict files"
          aria-valuemin={0}
          aria-valuemax={maxConflicts}
          aria-valuenow={conflictedFiles.length}
        >
          <div className={`boss-bar-fill ${allResolved ? 'drained' : ''}`} style={{ width: `${hpPct}%` }} />
        </div>
        <div className="conflict-branch">
          {mode === 'rebase' ? `rebase${rebaseKind === 'merge' ? ' (interactive)' : ''}` : lower} in progress
          {' '}on <span className="mono">{currentBranch}</span>
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
              {mode === 'rebase' ? 'Continue to apply the next commit, or abort to return to the previous state.'
                : mode === 'merge' ? 'Continue to finalize the merge commit, or abort to return to the previous state.'
                : mode === 'stash' ? 'Your resolved changes are staged. Finish to keep them (then drop the stash when you are happy), or abort to restore the conflicted files.'
                : `Continue to finish the ${lower}, or abort to return to the previous state.`}
            </div>
          </div>
        ) : (
          <>
            <div className="conflict-instructions">
              <strong>{conflictedFiles.length}</strong> {conflictedFiles.length === 1 ? 'file has' : 'files have'} conflicts.
              <br />
              <span className="conflict-step">1.</span> Click a file to open it in the conflict editor and pick current / incoming / both per block.
              <br />
              <span className="conflict-step">2.</span> <em>Save &amp; Mark Resolved</em> stages it (or fix it externally and click <em>Mark resolved</em>).
              <br />
              <span className="conflict-step">3.</span> {controls.canContinue ? 'Continue' : 'Finish'} when all files are marked resolved.
            </div>
            <div className="conflict-file-list">
              {conflictedFiles.map((path, i) => (
                <button
                  key={path}
                  ref={(el) => { rowRefs.current[i] = el }}
                  className={`conflict-file-row ${focusedIdx === i ? 'focused' : ''}`}
                  onClick={() => { setFocusedIdx(i); onSelectDiff(path) }}
                >
                  <span className="conflict-file-icon"><Icon name="warning" size={13} /></span>
                  <span className="conflict-file-path mono truncate" title={path}>{path}</span>
                  <span
                    className="conflict-mark-btn"
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => { e.stopPropagation(); handleMarkResolved(path) }}
                    title="Mark this file as resolved (stages it)"
                  >
                    Mark resolved <Icon name="check" size={11} />
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="conflict-footer">
        <button className="btn btn-ghost" onClick={() => setConfirmAbort(true)}>Abort {lower}</button>
        <div style={{ flex: 1 }} />
        {controls.canSkip && (
          <button className="btn btn-ghost" onClick={handleSkip} title={`Skip the current commit and continue the ${lower}`}>Skip commit</button>
        )}
        {controls.canContinue ? (
          <button
            className="btn btn-primary"
            onClick={handleContinue}
            disabled={!allResolved}
            title={allResolved ? 'Resume the operation' : 'Resolve all files first'}
          >
            Continue {lower}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={onRefresh}
            disabled={!allResolved}
            title={allResolved ? 'Done — the re-applied changes stay in your working tree' : 'Resolve all files first'}
          >
            Finish
          </button>
        )}
      </div>

      {confirmAbort && (
        <ConfirmModal
          title={`Abort ${lower}?`}
          message={mode === 'stash'
            ? 'The conflicted files are restored from HEAD. The stash entry stays on the stack, so nothing is lost.'
            : `Your repository will return to the state before this ${lower} started.`}
          confirmLabel={`Abort ${lower}`}
          danger
          onClose={() => setConfirmAbort(false)}
          onConfirm={doAbort}
        />
      )}
    </div>
  )
}

