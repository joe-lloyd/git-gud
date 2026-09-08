import React, { useEffect, useRef } from 'react'
import { Icon } from '../Icons/Icon'
import './FindBar.css'

interface FindBarProps {
  query: string
  onQueryChange: (q: string) => void
  /** Total matches for the current query. */
  count: number
  /** Index of the highlighted match (0-based); ignored when count is 0. */
  active: number
  onNext: () => void
  onPrev: () => void
  onClose: () => void
  /**
   * Bump to pull focus back into the input (Cmd/Ctrl+F while the bar is
   * already open). Any change re-focuses and selects the current text.
   */
  focusRequest?: number
  placeholder?: string
}

// Inline find bar for text shown in the main panel (diffs, conflict files).
// Deliberately narrow: literal, case-insensitive, Enter / Shift+Enter cycle,
// Escape closes just the bar. Highlighting is the host's job — it knows how
// its rows are rendered; this only owns the query and the navigation UI.
export const FindBar: React.FC<FindBarProps> = ({
  query, onQueryChange, count, active, onNext, onPrev, onClose, focusRequest = 0, placeholder = 'Find in file…',
}) => {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [focusRequest])

  return (
    <div className="find-bar" role="search" aria-label="Find in file">
      <span className="find-bar-icon"><Icon name="search" size={13} /></span>
      <input
        ref={inputRef}
        className="find-bar-input mono"
        placeholder={placeholder}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        spellCheck={false}
        aria-label="Find in file"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // Stop the host's window-level Escape (which closes the whole
            // viewer) from seeing this press — Escape here only closes the bar.
            e.preventDefault(); e.stopPropagation(); onClose()
          } else if (e.key === 'Enter') {
            e.preventDefault(); if (e.shiftKey) onPrev(); else onNext()
          } else if (e.key === 'ArrowDown') {
            e.preventDefault(); onNext()
          } else if (e.key === 'ArrowUp') {
            e.preventDefault(); onPrev()
          } else if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
            // Already here — just keep the text selected for a new query.
            e.preventDefault(); e.stopPropagation(); e.currentTarget.select()
          }
        }}
      />
      <span className={`find-bar-count ${query && count === 0 ? 'find-bar-count-none' : ''}`} aria-live="polite">
        {query === '' ? '' : count === 0 ? 'No matches' : `${active + 1} / ${count}`}
      </span>
      <span className="find-bar-nav">
        <button onClick={onPrev} disabled={count === 0} title="Previous match (Shift+Enter / ↑)" aria-label="Previous match"><Icon name="arrow-up" size={12} /></button>
        <button onClick={onNext} disabled={count === 0} title="Next match (Enter / ↓)" aria-label="Next match"><Icon name="arrow-down" size={12} /></button>
      </span>
      <button className="find-bar-close" onClick={onClose} title="Close find (Esc)" aria-label="Close find"><Icon name="x" size={12} /></button>
    </div>
  )
}

/**
 * Render a plain-text fragment with find hits wrapped in <mark>. `ranges` and
 * `active` are in the coordinate space of the whole logical line; `off` is
 * where this fragment starts within it, so a hit spanning two adjacent
 * fragments is styled active in both pieces.
 */
export function markPlain(text: string, ranges: readonly [number, number][], active: [number, number] | null, off = 0): React.ReactNode {
  if (ranges.length === 0) return text
  const nodes: React.ReactNode[] = []
  let pos = 0
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  sorted.forEach(([s, e], k) => {
    const cs = Math.max(0, s - off), ce = Math.min(text.length, e - off)
    if (ce <= cs || cs < pos) return
    if (cs > pos) nodes.push(text.slice(pos, cs))
    const isActive = active !== null && s >= active[0] && e <= active[1]
    nodes.push(<mark key={k} className={`find-mark ${isActive ? 'find-mark-active' : ''}`}>{text.slice(cs, ce)}</mark>)
    pos = ce
  })
  if (pos < text.length) nodes.push(text.slice(pos))
  return nodes
}
