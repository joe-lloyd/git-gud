import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitActivity } from '../../../preload/index'
import './ConsoleDock.css'

interface ConsoleDockProps {
  /** Active worktree path — both consoles reset when it changes. */
  repoPath: string | null
  height: number
  splitPct: number
  onVDragStart: (e: React.MouseEvent) => void
  onSplitDragStart: (e: React.MouseEvent) => void
  onClose: () => void
  /** Called after a typed command finishes — the app refreshes so graph,
      sidebar, tags etc. immediately reflect whatever the command changed. */
  onCommandDone?: () => void
}

const MAX_GIT_ENTRIES = 500
const MAX_CONSOLE_CHUNKS = 4000

export const ConsoleDock: React.FC<ConsoleDockProps> = ({
  repoPath, height, splitPct, onVDragStart, onSplitDragStart, onClose, onCommandDone,
}) => {
  return (
    <div className="console-dock" style={{ height }}>
      <div className="panel-resize-handle panel-resize-handle--h cdock-top" onMouseDown={onVDragStart} title="Drag to resize">
        <div className="panel-resize-grip panel-resize-grip--h" />
      </div>
      <div className="cdock-body">
        <div className="cdock-pane" style={{ width: `${splitPct}%` }}>
          <CommandConsole repoPath={repoPath} onCommandDone={onCommandDone} />
        </div>
        <div className="panel-resize-handle panel-resize-handle--v" onMouseDown={onSplitDragStart} title="Drag to resize">
          <div className="panel-resize-grip panel-resize-grip--v" />
        </div>
        <div className="cdock-pane cdock-grow">
          <GitActivityConsole repoPath={repoPath} onClose={onClose} />
        </div>
      </div>
    </div>
  )
}

// ── Left: command console ───────────────────────────────────────────────────

type Line = { stream: 'cmd' | 'stdout' | 'stderr' | 'meta'; text: string }

const CommandConsole: React.FC<{ repoPath: string | null; onCommandDone?: () => void }> = ({ repoPath, onCommandDone }) => {
  const [cwd, setCwd] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const [runId, setRunId] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const runIdRef = useRef<string | null>(null)
  runIdRef.current = runId

  // Reset + (re)fetch the cwd when the repo/worktree changes.
  useEffect(() => {
    setLines([]); setInput(''); setRunId(null); setHistIdx(-1)
    window.gitApi.getRepoRoot().then(setCwd).catch(() => setCwd(null))
  }, [repoPath])

  // Stream output for the active run.
  const onDoneRef = useRef(onCommandDone)
  onDoneRef.current = onCommandDone
  useEffect(() => {
    const unsub = window.gitApi.onConsoleOutput((e) => {
      if (e.runId !== runIdRef.current) return
      if ('done' in e && e.done) {
        setLines((l) => cap([...l, { stream: 'meta', text: `↳ exit ${e.exitCode ?? '—'}` }]))
        setRunId(null)
        // The command may have rewritten history / refs / the working tree —
        // reload app state so the graph and sidebar reflect it immediately.
        onDoneRef.current?.()
        return
      }
      if ('chunk' in e) setLines((l) => cap([...l, { stream: e.stream, text: e.chunk }]))
    })
    return unsub
  }, [])

  // Auto-scroll to the bottom on new output if already near it.
  useEffect(() => {
    const el = bodyRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight
  }, [lines])

  const cap = (l: Line[]) => (l.length > MAX_CONSOLE_CHUNKS ? l.slice(l.length - MAX_CONSOLE_CHUNKS) : l)

  const run = useCallback(async () => {
    const cmd = input.trim()
    if (!cmd || runId) return
    const id = crypto.randomUUID()
    // Set the ref synchronously — fast commands (e.g. `pwd`) can stream output
    // back before React commits the setRunId render, and the output listener
    // filters on runIdRef. Without this, that early output is dropped.
    runIdRef.current = id
    setLines((l) => cap([...l, { stream: 'cmd', text: `$ ${cmd}` }]))
    setHistory((h) => [...h, cmd]); setHistIdx(-1); setInput('')
    setRunId(id)
    try {
      const r = await window.gitApi.runConsoleCommand(id, cmd)
      if (!r.success && r.error) setLines((l) => cap([...l, { stream: 'stderr', text: r.error! }]))
    } catch (err) {
      // e.g. the IPC handler isn't registered (stale main process) — surface it.
      setLines((l) => cap([...l, { stream: 'stderr', text: String(err) }]))
      runIdRef.current = null
      setRunId(null)
    }
  }, [input, runId])

  const cancel = useCallback(() => {
    if (runId) window.gitApi.cancelConsoleCommand(runId)
  }, [runId])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); run(); return }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      const next = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1)
      setHistIdx(next); setInput(history[next] ?? '')
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histIdx < 0) return
      const next = histIdx + 1
      if (next >= history.length) { setHistIdx(-1); setInput('') }
      else { setHistIdx(next); setInput(history[next] ?? '') }
    }
  }

  return (
    <div className="cdock-inner">
      <div className="cdock-head">
        <span className="cdock-title">Console</span>
        <span className="cdock-cwd mono" title={cwd ?? ''}><bdi>{cwd ?? '—'}</bdi></span>
        <span className="cdock-spacer" />
        {runId && <button className="cdock-btn" onClick={cancel} title="Terminate">■ Stop</button>}
        <button className="cdock-btn" onClick={() => setLines([])} title="Clear">Clear</button>
      </div>
      <div className="cdock-log cdock-cmd-log" ref={bodyRef}>
        {lines.map((l, i) => <div key={i} className={`cdock-line cdock-${l.stream}`}>{l.text}</div>)}
      </div>
      <div className="cdock-input-row">
        <span className="cdock-prompt">$</span>
        <input
          className="cdock-input mono"
          placeholder={repoPath ? 'Run a command at the worktree root…' : 'Open a repository first'}
          value={input}
          disabled={!repoPath}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  )
}

// ── Right: git activity log ─────────────────────────────────────────────────

// Wall-clock HH:MM:SS for an activity record's start time. Manual pad rather
// than toLocaleTimeString so it's always 24-hour and locale-independent.
const fmtTime = (ts: number) => {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// Serialize one activity record the way you'd paste it into a terminal/issue.
const formatEntry = (e: GitActivity) =>
  `[${fmtTime(e.ts)}] $ git ${e.args.join(' ')}\n${e.output}${e.output.endsWith('\n') || !e.output ? '' : '\n'}↳ ${e.failed ? 'failed' : 'ok'}${e.exitCode != null ? ` (exit ${e.exitCode})` : ''} · ${e.durationMs}ms`

const GitActivityConsole: React.FC<{ repoPath: string | null; onClose: () => void }> = ({ repoPath, onClose }) => {
  const [entries, setEntries] = useState<GitActivity[]>([])
  // Default view shows only mutations (rebase, reset, pull…) plus anything
  // that failed — the routine read-polling (status/log/refs on every refresh)
  // is noise. Flip to "all" to audit the reads too.
  const [showReads, setShowReads] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const prevScrollHeightRef = useRef(0)

  useEffect(() => { setEntries([]) }, [repoPath]) // reset on repo/worktree switch

  useEffect(() => {
    const unsub = window.gitApi.onGitActivity((rec) => {
      setEntries((e) => {
        const next = [...e, rec]
        return next.length > MAX_GIT_ENTRIES ? next.slice(next.length - MAX_GIT_ENTRIES) : next
      })
    })
    return unsub
  }, [])

  // Stored oldest→newest (append order); shown newest-first so the latest
  // command is always on top and you scroll DOWN into history.
  const visible = showReads ? entries : entries.filter((e) => e.kind !== 'read' || e.failed)
  const ordered = useMemo(() => [...visible].reverse(), [visible])

  // New entries are inserted at the TOP. If the user is following (near the
  // top) keep them pinned to the newest; if they've scrolled down to read
  // older history, nudge scrollTop by the height that was added above so the
  // viewport stays visually still instead of jumping.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    if (el.scrollTop < 40) {
      el.scrollTop = 0
    } else {
      const delta = el.scrollHeight - prevScrollHeightRef.current
      if (delta > 0) el.scrollTop += delta
    }
    prevScrollHeightRef.current = el.scrollHeight
  }, [ordered.length])

  const copyAll = () => {
    navigator.clipboard.writeText(ordered.map(formatEntry).join('\n\n')).catch(() => {})
  }
  const copyOne = (e: GitActivity) => {
    navigator.clipboard.writeText(formatEntry(e)).catch(() => {})
  }

  return (
    <div className="cdock-inner">
      <div className="cdock-head">
        <span className="cdock-title">Git Activity</span>
        <span className="cdock-count">{visible.length}{!showReads && entries.length !== visible.length ? ` / ${entries.length}` : ''}</span>
        <span className="cdock-spacer" />
        <button
          className={`cdock-btn ${showReads ? 'cdock-btn-on' : ''}`}
          onClick={() => setShowReads(s => !s)}
          title={showReads ? 'Showing every command — click to hide read-only queries' : 'Read-only queries hidden — click to show everything'}
        >
          {showReads ? 'All commands' : 'Changes only'}
        </button>
        <button className="cdock-btn" onClick={copyAll} title="Copy visible log">⧉ Copy</button>
        <button className="cdock-btn" onClick={() => setEntries([])} title="Clear">Clear</button>
        <button className="cdock-btn cdock-close" onClick={onClose} title="Hide console">✕</button>
      </div>
      <div className="cdock-log" ref={bodyRef}>
        {ordered.length === 0 && (
          <div className="cdock-empty">
            {entries.length === 0
              ? 'No git activity yet.'
              : 'No repo-changing commands yet — switch to "All commands" to see read-only queries.'}
          </div>
        )}
        {ordered.map((e) => (
          <div key={e.id} className={`cdock-entry ${e.failed ? 'failed' : ''}`}>
            <div className="cdock-cmdline mono">
              <span className="cdock-time" title={new Date(e.ts).toLocaleString()}>{fmtTime(e.ts)}</span>
              <span className="cdock-cmdtext">$ git {e.args.join(' ')}</span>
              <button className="cdock-entry-copy" onClick={() => copyOne(e)} title="Copy this command + output">⧉</button>
            </div>
            {e.output.trim() && <div className="cdock-output mono">{e.output.replace(/\n+$/, '')}</div>}
            <div className="cdock-status">
              <span className={e.failed ? 'cdock-fail' : 'cdock-ok'}>
                {e.failed ? '✗ failed' : '✓ ok'}{e.exitCode != null ? ` (exit ${e.exitCode})` : ''}
              </span>
              <span className="cdock-dur">{e.durationMs}ms</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
