import React, { useEffect, useRef, useState } from 'react'
import './CommitOutput.css'

export type OutputChunk = { stream: 'stdout' | 'stderr'; text: string }
export type CommitOutputStatus = 'running' | 'success' | 'failed'

interface CommitOutputProps {
  /** Human-readable command being run, e.g. `git commit -m "…"`. */
  command: string
  chunks: OutputChunk[]
  status: CommitOutputStatus
  exitCode: number | null
  onClose: () => void
}

// Live, copyable view of a commit's stdout+stderr (including hook output),
// rendered in the center pane. Stays open on failure so nothing is lost; the
// user copies the full log (with a command + exit-code header) to paste into a
// coding assistant.
export const CommitOutput: React.FC<CommitOutputProps> = ({ command, chunks, status, exitCode, onClose }) => {
  const logRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  // Auto-scroll to the bottom while output streams in, unless the user has
  // scrolled up to read earlier lines.
  useEffect(() => {
    const el = logRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (status === 'running' || nearBottom) el.scrollTop = el.scrollHeight
  }, [chunks, status])

  const plain = chunks.map((c) => c.text).join('')

  const handleCopy = async () => {
    const header = `$ ${command}\n(exit ${exitCode ?? '—'})\n\n`
    try {
      await navigator.clipboard.writeText(header + plain)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard denied — nothing actionable to show */
    }
  }

  const statusLabel =
    status === 'running' ? 'Running…' :
    status === 'success' ? 'Succeeded' :
    `Failed${exitCode != null ? ` (exit ${exitCode})` : ''}`

  return (
    <div className="commit-output">
      <div className={`co-header co-${status}`}>
        <span className="co-status-dot" />
        <span className="co-title">Commit output</span>
        <span className="co-status-label">{statusLabel}</span>
        <span className="co-spacer" />
        <button className="co-btn" onClick={handleCopy} title="Copy full log">
          {copied ? '✓ Copied' : '⧉ Copy'}
        </button>
        <button className="co-btn co-close" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="co-command" title={command}>$ {command}</div>

      <div className="co-log" ref={logRef}>
        {chunks.length === 0 && status === 'running' && (
          <span className="co-waiting">Waiting for git…</span>
        )}
        {chunks.map((c, i) => (
          <span key={i} className={c.stream === 'stderr' ? 'co-stderr' : 'co-stdout'}>{c.text}</span>
        ))}
      </div>
    </div>
  )
}
