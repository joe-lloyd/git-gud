import React, { useState, useCallback, useRef } from 'react'
import type { CommitNode, FileChange, GerritChange } from '../../../preload/index'
import { Icon, IconName } from '../Icons/Icon'
import { groupRefs } from '../../lib/refs'
import { splitTrailers } from '../../lib/trailers'
import '../Gerrit/Gerrit.css'
import './CommitDetail.css'

// The selected commit's relationship to an open Gerrit change: it is either
// the change's current patchset or an older one (an outdated base another
// change still builds on). Computed in App from the open-changes list.
export interface GerritCommitInfo {
  change: GerritChange
  patchsetNumber: number
  isCurrent: boolean
}

interface CommitDetailProps {
  sha: string | null
  commits: CommitNode[]
  /** Currently-open file diff in the main view (so we can highlight its row) */
  selectedFile?: string | null
  /** Click a file row to open its diff in the main view (toggles: clicking the
      open file closes it) */
  onSelectFile?: (path: string, sha: string) => void
  /** Open a file's diff without toggle semantics — used by arrow-key traversal
      so walking the list never closes the diff. */
  onOpenFile?: (path: string, sha: string) => void
  /** Gerrit web base URL — makes the Change-Id trailer pill a link. */
  gerritHost?: string | null
  /** Set when the selected commit is a patchset of an open Gerrit change. */
  gerritInfo?: GerritCommitInfo | null
  /** Focus + scroll the graph to another commit (jump to current patchset). */
  onJumpToSha?: (sha: string) => void
}

export const CommitDetail: React.FC<CommitDetailProps> = ({ sha, commits, selectedFile = null, onSelectFile, onOpenFile, gerritHost = null, gerritInfo = null, onJumpToSha }) => {
  const [files, setFiles] = useState<FileChange[]>([])
  const [loading, setLoading] = useState(false)
  // Keyboard traversal (same pattern as WorkingTree): armed by clicking a file
  // row, then arrows walk the list while the diff view follows. Starts null so
  // stray arrow presses don't hijack anything before the user enters the list.
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null)
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([])
  // Full message (subject + body) — fetched on demand because the log payload
  // only carries the subject (`%s`). Empty until loaded; we fall back to the
  // commit's subject if the fetch fails.
  const [fullMessage, setFullMessage] = useState<string>('')

  const commit = commits.find((c) => c.sha === sha)

  const loadDetails = useCallback(async (sha: string) => {
    setLoading(true)
    try {
      const [f, msg] = await Promise.all([
        window.gitApi.getCommitFiles(sha),
        window.gitApi.getCommitMessage(sha),
      ])
      setFiles(f)
      setFullMessage(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (sha) loadDetails(sha)
    else { setFiles([]); setFullMessage('') }
    setFocusedIdx(null)
  }, [sha, loadDetails])

  // Arrow keys traverse the file list and open each file's diff as they go.
  // Attached to the panel root and driven by bubbling from the focused row
  // button, so it only ever fires while focus is inside this panel — the main
  // diff view never loses arrows it owns (it doesn't take focus in commit mode).
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (files.length === 0 || !sha) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (focusedIdx === null) return
    const focusRow = (idx: number) => {
      const clamped = Math.max(0, Math.min(files.length - 1, idx))
      if (clamped === focusedIdx) return
      setFocusedIdx(clamped)
      rowRefs.current[clamped]?.focus()
      const f = files[clamped]
      if (f) (onOpenFile ?? onSelectFile)?.(f.path, sha)
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(focusedIdx + 1); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); focusRow(focusedIdx - 1); return }
    if (e.key === 'Home')      { e.preventDefault(); focusRow(0); return }
    if (e.key === 'End')       { e.preventDefault(); focusRow(files.length - 1); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const f = files[focusedIdx]
      if (f) onSelectFile?.(f.path, sha) // toggle, like a click
    }
  }, [files, sha, focusedIdx, onOpenFile, onSelectFile])
  rowRefs.current.length = files.length

  if (!commit) {
    return (
      <div className="commit-detail empty">
        <p>Select a commit to view details</p>
      </div>
    )
  }

  // Same visual language as WorkingTree's status icons.
  const statusIcon: Record<string, IconName> = {
    M: 'edit', A: 'plus', D: 'minus', R: 'arrow-right', C: 'copy', U: 'question',
  }
  const statusColor: Record<string, string> = {
    M: '#f6ad55', A: '#68d391', D: '#fc8181', R: '#b794f4', C: '#76e4f7', U: '#fc8181',
  }

  return (
    <div className="commit-detail fade-in" onKeyDown={handleKeyDown}>
      {/* Header */}
      <div className="cd-header">
        <div className="cd-sha mono">{commit.sha.slice(0, 7)}</div>
        <div className="cd-author">{commit.author}</div>
        <div className="cd-date">{new Date(commit.date).toLocaleString()}</div>
      </div>
      {(() => {
        // First line of the fetched %B is the subject; everything after the
        // first blank line is the body. Fall back to commit.message (subject
        // only) while the fetch is in flight. A trailing trailer paragraph
        // (Change-Id, Signed-off-by, …) is lifted out of the prose and
        // rendered as pills.
        const source = fullMessage || commit.message
        const lines = source.split('\n')
        const subject = lines[0] ?? ''
        const sep = lines.findIndex((l, i) => i > 0 && l.trim() === '')
        const body = sep >= 0 ? lines.slice(sep + 1).join('\n') : lines.slice(1).join('\n')
        const { text, trailers } = splitTrailers(body)
        return (
          <>
            <div className="cd-message">{subject}</div>
            {text.trim() && <pre className="cd-body-msg">{text}</pre>}
            {trailers.length > 0 && (
              <div className="cd-trailers">
                {trailers.map((t, i) => {
                  const isChangeId = t.key.toLowerCase() === 'change-id'
                  const link = isChangeId && gerritHost ? `${gerritHost}/q/${t.value}` : null
                  // Change-Ids are 41 opaque chars — show the opening prefix
                  // (Gerrit matches by prefix, like SHAs); full id in tooltip.
                  const display = isChangeId && /^I[0-9a-fA-F]{8,}$/.test(t.value)
                    ? `${t.value.slice(0, 5)}…`
                    : t.value
                  return (
                    <span
                      key={`${t.key}-${i}`}
                      className={`cd-trailer ${link ? 'cd-trailer-link' : ''}`}
                      title={link ? `${t.key}: ${t.value} — open on Gerrit` : `${t.key}: ${t.value}`}
                      onClick={link ? () => window.uiApi.openExternal(link) : undefined}
                    >
                      <span className="cd-trailer-key">{t.key}</span>
                      <span className="cd-trailer-value">{display}</span>
                    </span>
                  )
                })}
              </div>
            )}
          </>
        )
      })()}

      {/* Refs — same grouping + icon language as the graph's pills: one pill
          per branch name, with local (branch) and remote (cloud) icons both
          shown when the branch exists on both sides. */}
      {commit.refs.length > 0 && (
        <div className="cd-refs">
          {groupRefs(commit.refs, new Set()).map((g) => {
            const cls = g.isTag ? 'ref-tag' :
              g.isGerritChange ? `ref-gerrit${g.isOutdatedPatchset ? ' ref-gerrit-outdated' : ''}` :
              g.isHead ? 'ref-head' :
              g.hasLocal && g.hasRemote ? 'ref-both' :
              g.hasRemote ? 'ref-remote' : 'ref-local'
            return (
              <span key={g.key} className={`ref-pill ${cls}`} title={g.tooltip}>
                {g.isTag && <span className="rp-icon"><Icon name="tag" size={10} /></span>}
                {g.isGerritChange && <span className="rp-icon"><Icon name={g.isOutdatedPatchset ? 'history' : 'cloud'} size={10} /></span>}
                {g.isHead && <span className="rp-icon"><Icon name="dot-circle" size={10} /></span>}
                {g.hasLocal && !g.isTag && <span className="rp-icon"><Icon name="branch" size={10} /></span>}
                {g.hasRemote && !g.isGerritChange && <span className="rp-icon"><Icon name="cloud" size={10} /></span>}
                <span className="rp-name">{g.name}</span>
              </span>
            )
          })}
        </div>
      )}

      {/* Gerrit change block — the amendment (patchset) history for the
          selected node. Replaces the old changes panel: the graph carries the
          nodes, this carries the detail. */}
      {gerritInfo && (
        <div className="cd-gerrit">
          <div className="cd-gerrit-head">
            <span className="cd-gerrit-title">
              <Icon name="cloud" size={12} /> Change #{gerritInfo.change.number}
            </span>
            {gerritInfo.change.wip && <span className="gerrit-wip">WIP</span>}
            <span className="cd-gerrit-meta">→ {gerritInfo.change.branch} · {gerritInfo.change.owner}</span>
            <span style={{ flex: 1 }} />
            <button
              className="cd-gerrit-link"
              title="Open the change in the browser"
              onClick={() => window.uiApi.openExternal(gerritInfo.change.url)}
            >open ↗</button>
          </div>

          {!gerritInfo.isCurrent && (
            <div className="cd-gerrit-outdated">
              <Icon name="warning" size={11} /> Outdated — this is patchset {gerritInfo.patchsetNumber},
              the change is at patchset {gerritInfo.change.patchset}.
              {gerritInfo.change.currentSha && onJumpToSha && (
                <button className="cd-gerrit-link" onClick={() => onJumpToSha(gerritInfo.change.currentSha!)}>
                  jump to current
                </button>
              )}
            </div>
          )}

          {gerritInfo.change.patchsets.length > 0 && (
            <div className="cd-gerrit-patchsets">
              <div className="cd-section-title">Amendments ({gerritInfo.change.patchsets.length} patchset{gerritInfo.change.patchsets.length === 1 ? '' : 's'})</div>
              {gerritInfo.change.patchsets.map((ps) => (
                <div
                  key={ps.number}
                  className={`cd-gerrit-ps ${ps.number === gerritInfo.patchsetNumber ? 'selected' : ''}`}
                >
                  <span className="cd-gerrit-ps-num">PS{ps.number}</span>
                  {ps.number === gerritInfo.change.patchset && <span className="cd-gerrit-ps-current">current</span>}
                  <span className="cd-gerrit-ps-kind">{ps.kind.toLowerCase().replace(/_/g, ' ')}</span>
                  {/* Gerrit timestamps: "YYYY-MM-DD hh:mm:ss.nnnnnnnnn" (UTC) — show the date part */}
                  <span className="cd-gerrit-ps-date">{ps.created.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="divider" />

      {loading ? (
        <div className="cd-loading">
          <span className="spin" style={{ display: 'inline-block', fontSize: 18 }}>⟳</span>
        </div>
      ) : (
        <div className="cd-body">
          <div className="cd-files">
            <div className="cd-section-title">Files Changed ({files.length})</div>
            <div className="cd-file-list">
              {files.map((f, idx) => (
                <button
                  key={f.path}
                  ref={(el) => { rowRefs.current[idx] = el }}
                  className={`cd-file-item ${selectedFile === f.path ? 'active' : ''}`}
                  onClick={() => { setFocusedIdx(idx); if (sha) onSelectFile?.(f.path, sha) }}
                  title={f.path}
                >
                  <span
                    className="cd-file-status"
                    style={{ color: statusColor[f.status] ?? '#8b949e' }}
                  >
                    <Icon name={statusIcon[f.status] ?? 'question'} size={12} />
                  </span>
                  <span className="cd-file-path truncate">{f.path}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
