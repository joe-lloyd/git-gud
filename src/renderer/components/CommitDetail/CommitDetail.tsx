import React, { useState, useCallback } from 'react'
import type { CommitNode, FileChange } from '../../../preload/index'
import { Icon, IconName } from '../Icons/Icon'
import './CommitDetail.css'

interface CommitDetailProps {
  sha: string | null
  commits: CommitNode[]
  /** Currently-open file diff in the main view (so we can highlight its row) */
  selectedFile?: string | null
  /** Click a file row to open its diff in the main view */
  onSelectFile?: (path: string, sha: string) => void
}

export const CommitDetail: React.FC<CommitDetailProps> = ({ sha, commits, selectedFile = null, onSelectFile }) => {
  const [files, setFiles] = useState<FileChange[]>([])
  const [loading, setLoading] = useState(false)
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
  }, [sha, loadDetails])

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
    <div className="commit-detail fade-in">
      {/* Header */}
      <div className="cd-header">
        <div className="cd-sha mono">{commit.sha.slice(0, 7)}</div>
        <div className="cd-author">{commit.author}</div>
        <div className="cd-date">{new Date(commit.date).toLocaleString()}</div>
      </div>
      {(() => {
        // First line of the fetched %B is the subject; everything after the
        // first blank line is the body. Fall back to commit.message (subject
        // only) while the fetch is in flight.
        const source = fullMessage || commit.message
        const lines = source.split('\n')
        const subject = lines[0] ?? ''
        const sep = lines.findIndex((l, i) => i > 0 && l.trim() === '')
        const body = sep >= 0 ? lines.slice(sep + 1).join('\n') : lines.slice(1).join('\n')
        return (
          <>
            <div className="cd-message">{subject}</div>
            {body.trim() && <pre className="cd-body-msg">{body}</pre>}
          </>
        )
      })()}

      {/* Refs */}
      {commit.refs.length > 0 && (
        <div className="cd-refs">
          {commit.refs.map((ref) => {
            const cls = ref === 'HEAD' ? 'ref-head' :
              ref.startsWith('tag:') ? 'ref-tag' :
              ref.includes('/') ? 'ref-remote' : 'ref-local'
            const label = ref === 'HEAD' ? 'HEAD' :
              ref.startsWith('tag: ') ? ref.slice(5) :
              ref.split('/').slice(-1)[0]
            return <span key={ref} className={`ref-pill ${cls}`}>{label}</span>
          })}
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
              {files.map((f) => (
                <button
                  key={f.path}
                  className={`cd-file-item ${selectedFile === f.path ? 'active' : ''}`}
                  onClick={() => sha && onSelectFile?.(f.path, sha)}
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
