import React, { useState, useCallback } from 'react'
import type { CommitNode, FileChange } from '../../../preload/index'
import './CommitDetail.css'

interface CommitDetailProps {
  sha: string | null
  commits: CommitNode[]
}

export const CommitDetail: React.FC<CommitDetailProps> = ({ sha, commits }) => {
  const [files, setFiles] = useState<FileChange[]>([])
  const [diff, setDiff] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  const commit = commits.find((c) => c.sha === sha)

  const loadDetails = useCallback(async (sha: string) => {
    setLoading(true)
    setSelectedFile(null)
    setDiff('')
    try {
      const [f, d] = await Promise.all([
        window.gitApi.getCommitFiles(sha),
        window.gitApi.getCommitDiff(sha),
      ])
      setFiles(f)
      setDiff(d)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (sha) loadDetails(sha)
    else { setFiles([]); setDiff('') }
  }, [sha, loadDetails])

  if (!commit) {
    return (
      <div className="commit-detail empty">
        <p>Select a commit to view details</p>
      </div>
    )
  }

  const statusIcon: Record<string, string> = {
    M: '✎', A: '+', D: '−', R: '→', C: '⊕', U: '!',
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
      <div className="cd-message">{commit.message}</div>

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
          {/* Files */}
          <div className="cd-files">
            <div className="cd-section-title">Files Changed ({files.length})</div>
            <div className="cd-file-list">
              {files.map((f) => (
                <button
                  key={f.path}
                  className={`cd-file-item ${selectedFile === f.path ? 'active' : ''}`}
                  onClick={() => setSelectedFile(f.path === selectedFile ? null : f.path)}
                  title={f.path}
                >
                  <span
                    className="cd-file-status"
                    style={{ color: statusColor[f.status] ?? '#8b949e' }}
                  >
                    {statusIcon[f.status] ?? '?'}
                  </span>
                  <span className="cd-file-path truncate">{f.path}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Diff */}
          <div className="cd-diff">
            <div className="cd-section-title">Diff</div>
            <pre className="cd-diff-content mono">{diff || 'No diff available'}</pre>
          </div>
        </div>
      )}
    </div>
  )
}
