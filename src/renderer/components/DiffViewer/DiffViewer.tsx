import React, { useEffect, useState, useCallback } from 'react'
import './DiffViewer.css'

interface DiffViewerProps {
  filePath: string
  /** Working-tree mode: read against index. Ignored when `sha` is set. */
  staged?: boolean
  /** Commit mode: show the diff this commit introduced for `filePath`. */
  sha?: string | null
  onClose: () => void
  /** Working-tree mode only: re-fetched after a stage/unstage chunk applies. */
  onApplied?: () => void
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ filePath, staged = false, sha = null, onClose, onApplied }) => {
  const [diff, setDiff] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const isCommitMode = sha !== null

  const refreshDiff = useCallback(() => {
    setLoading(true)
    const p = isCommitMode
      ? window.gitApi.getCommitFileDiff(sha!, filePath)
      : window.gitApi.getFileDiff(filePath, staged)
    p.then((d) => {
      setDiff(d || '')
      setLoading(false)
    })
  }, [filePath, staged, sha, isCommitMode])

  useEffect(() => { refreshDiff() }, [refreshDiff])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Parse unified diff into typed lines with hunk bounds AND track each row's
  // line number against the original (oldNo) and new (newNo) file. Hunk
  // headers (@@ -a,b +c,d @@) reset the counters; context advances both,
  // remove advances only oldNo, add advances only newNo. "\ No newline at
  // end of file" markers don't consume a line number.
  let currentHunkIndex = -1
  let oldCursor = 0
  let newCursor = 0
  const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
  const lines = diff.split('\n').map((text, i) => {
    let type: 'add' | 'remove' | 'hunk' | 'header' | 'context' = 'context'
    let oldNo: number | null = null
    let newNo: number | null = null

    if (currentHunkIndex === -1 && !text.startsWith('@@')) {
      type = 'header'
    } else if (text.startsWith('@@')) {
      type = 'hunk'
      currentHunkIndex = i
      const m = text.match(HUNK_RE)
      if (m) {
        oldCursor = parseInt(m[1], 10)
        newCursor = parseInt(m[2], 10)
      }
    } else if (text.startsWith('\\')) {
      // "\ No newline at end of file" — informational, no line number
      type = 'context'
    } else if (text.startsWith('+')) {
      type = 'add'
      newNo = newCursor++
    } else if (text.startsWith('-')) {
      type = 'remove'
      oldNo = oldCursor++
    } else if (currentHunkIndex !== -1) {
      type = 'context'
      oldNo = oldCursor++
      newNo = newCursor++
    }

    return { text, type, i, hunkIndex: currentHunkIndex, oldNo, newNo }
  })

  const applyPatch = async (patch: string) => {
    if (isCommitMode) return // read-only in commit mode
    setLoading(true)
    const r = await window.gitApi.applyPatch(patch, { cached: true, reverse: staged })
    if (r.success) onApplied?.()
    refreshDiff()
  }

  const handleStageChunk = (hunkStart: number) => {
    const patchLines = lines.filter(l => l.type === 'header').map(l => l.text)
    for (let i = hunkStart; i < lines.length; i++) {
      if (i > hunkStart && lines[i].type === 'hunk') break
      patchLines.push(lines[i].text)
    }
    applyPatch(patchLines.join('\n') + '\n')
  }

  const handleStageLine = (hunkStart: number, targetIdx: number) => {
    const patchLines = lines.filter(l => l.type === 'header').map(l => l.text)
    for (let i = hunkStart; i < lines.length; i++) {
      if (i > hunkStart && lines[i].type === 'hunk') break
      const l = lines[i]
      if (l.type === 'hunk' || i === targetIdx) patchLines.push(l.text)
      else if (l.type === 'context') patchLines.push(l.text)
      else if (l.type === 'remove') patchLines.push(' ' + l.text.slice(1))
    }
    applyPatch(patchLines.join('\n') + '\n')
  }

  return (
    <div className="diff-viewer fade-in">
      {/* Header bar */}
      <div className="diff-header">
        <span className="diff-header-label">
          {isCommitMode ? (
            <span className="diff-badge diff-badge-commit mono">{sha!.slice(0, 7)}</span>
          ) : (
            <span className={`diff-badge ${staged ? 'diff-badge-staged' : 'diff-badge-unstaged'}`}>
              {staged ? 'Staged' : 'Unstaged'}
            </span>
          )}
          <span className="diff-filename">{filePath}</span>
        </span>
        <button className="diff-close" onClick={onClose} title="Close diff (Esc)">✕ Close</button>
      </div>

      {/* Diff body */}
      {loading ? (
        <div className="diff-loading">Loading diff…</div>
      ) : diff.trim() === '' ? (
        <div className="diff-loading">No diff available for this file.</div>
      ) : (
        <div className="diff-body">
          <table className="diff-table">
            <tbody>
              {lines.map(({ text, type, i, hunkIndex, oldNo, newNo }) => {
                const lineActionable = !isCommitMode && (type === 'add' || type === 'remove')
                return (
                  <tr key={i} className={`diff-line diff-line-${type}`}>
                    <td className="diff-gutter diff-gutter-old">{oldNo ?? ''}</td>
                    <td className="diff-gutter diff-gutter-new">{newNo ?? ''}</td>
                    <td className={`diff-sign ${lineActionable ? 'diff-sign-actionable' : ''}`}
                        onClick={() => lineActionable && handleStageLine(hunkIndex, i)}
                        title={lineActionable ? (staged ? 'Unstage Line' : 'Stage Line') : ''}>
                      {type === 'add' ? '+' : type === 'remove' ? '−' : ''}
                    </td>
                    <td className="diff-content">
                      {text.slice(type === 'context' ? 0 : 1)}
                      {type === 'hunk' && !isCommitMode && (
                        <button className="diff-chunk-btn" onClick={() => handleStageChunk(i)}>
                          {staged ? 'Unstage Chunk ↑' : 'Stage Chunk ↓'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
