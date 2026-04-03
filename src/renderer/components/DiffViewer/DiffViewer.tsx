import React, { useEffect, useState, useCallback } from 'react'
import './DiffViewer.css'

interface DiffViewerProps {
  filePath: string
  staged: boolean
  onClose: () => void
  onApplied: () => void
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ filePath, staged, onClose, onApplied }) => {
  const [diff, setDiff] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const refreshDiff = useCallback(() => {
    setLoading(true)
    window.gitApi.getFileDiff(filePath, staged).then((d) => {
      setDiff(d || '')
      setLoading(false)
    })
  }, [filePath, staged])

  useEffect(() => { refreshDiff() }, [refreshDiff])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Parse unified diff into typed lines with hunk bounds
  let currentHunkIndex = -1
  const lines = diff.split('\n').map((text, i) => {
    let type: 'add' | 'remove' | 'hunk' | 'header' | 'context' = 'context'
    if (currentHunkIndex === -1 && !text.startsWith('@@')) {
      type = 'header'
    } else if (text.startsWith('@@')) {
      type = 'hunk'
      currentHunkIndex = i
    } else if (text.startsWith('+')) {
      type = 'add'
    } else if (text.startsWith('-')) {
      type = 'remove'
    }
    if (text.startsWith('\\')) type = 'context' // No newline at end of file
    return { text, type, i, hunkIndex: currentHunkIndex }
  })

  const applyPatch = async (patch: string) => {
    setLoading(true)
    const success = await window.gitApi.applyPatch(patch, { cached: true, reverse: staged })
    if (success) onApplied()
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
          <span className={`diff-badge ${staged ? 'diff-badge-staged' : 'diff-badge-unstaged'}`}>
            {staged ? 'Staged' : 'Unstaged'}
          </span>
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
              {lines.map(({ text, type, i, hunkIndex }) => (
                <tr key={i} className={`diff-line diff-line-${type}`}>
                  <td className="diff-gutter">{type !== 'hunk' && type !== 'header' ? i + 1 : ''}</td>
                  <td className={`diff-sign ${type === 'add' || type === 'remove' ? 'diff-sign-actionable' : ''}`}
                      onClick={() => (type === 'add' || type === 'remove') && handleStageLine(hunkIndex, i)}
                      title={type === 'add' || type === 'remove' ? (staged ? 'Unstage Line' : 'Stage Line') : ''}>
                    {type === 'add' ? '+' : type === 'remove' ? '−' : ''}
                  </td>
                  <td className="diff-content">
                    {text.slice(type === 'context' ? 0 : 1)}
                    {type === 'hunk' && (
                      <button className="diff-chunk-btn" onClick={() => handleStageChunk(i)}>
                        {staged ? 'Unstage Chunk ↑' : 'Stage Chunk ↓'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
