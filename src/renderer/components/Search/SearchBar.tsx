import React, { useState, useRef, useEffect, useMemo } from 'react'
import type { CommitNode } from '../../../preload/index'
import { Icon } from '../Icons/Icon'
import './SearchBar.css'

interface SearchBarProps {
  commits: CommitNode[]
  /** Focus (select + scroll to) a commit. Called for the most recent match as you type, then for ↑/↓/Enter. */
  onFocus: (sha: string) => void
  /** Every matching SHA (graph dims the rest); null = no active search. */
  onMatches: (shas: Set<string> | null) => void
  onClose: () => void
}

type SearchMode = 'message' | 'content'
const PICKAXE_LIMIT = 200
const LIST_LIMIT = 300 // rows rendered in the dropdown; the graph still dims against ALL matches

// Search finds every commit that matches, focuses the most recent one (the
// graph is newest-first, so that's index 0) and dims everything else in the
// graph. Enter / ↓ walks to older matches, ↑ back. The panel floats top-right
// and never covers the graph, so you see matches light up as you type.
export const SearchBar: React.FC<SearchBarProps> = ({ commits, onFocus, onMatches, onClose }) => {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('message')
  const [pickaxeResults, setPickaxeResults] = useState<CommitNode[]>([])
  const [pickaxeLoading, setPickaxeLoading] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Pickaxe is server-side and potentially slow on large repos — debounce so
  // typing doesn't fire an IPC per keystroke.
  useEffect(() => {
    if (mode !== 'content') return
    const q = query.trim()
    if (q.length < 2) { setPickaxeResults([]); setPickaxeLoading(false); return }
    setPickaxeLoading(true)
    const handle = window.setTimeout(async () => {
      try {
        const r = await window.gitApi.logPickaxe(q, PICKAXE_LIMIT)
        setPickaxeResults(r)
      } finally { setPickaxeLoading(false) }
    }, 250)
    return () => window.clearTimeout(handle)
  }, [query, mode])

  const q = query.trim().toLowerCase()
  const messageResults = useMemo(() => {
    if (q.length < 2) return []
    return commits.filter((c) =>
      c.message.toLowerCase().includes(q) ||
      c.author.toLowerCase().includes(q) ||
      c.sha.startsWith(q),
    )
  }, [commits, q])

  // Newest first — commits are already in graph order (index 0 = most recent).
  const results = mode === 'content' ? pickaxeResults : messageResults
  const searching = q.length >= 2 && !(mode === 'content' && pickaxeLoading)

  // Publish matches to the graph and focus the most recent one whenever the
  // result set changes.
  const resultKey = results.map((c) => c.sha).join('\n')
  useEffect(() => {
    if (!searching) { onMatches(null); return }
    onMatches(new Set(results.map((c) => c.sha)))
    setActive(0)
    if (results[0]) onFocus(results[0].sha)
  }, [resultKey, searching]) // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving clears the dimming; the focused commit stays selected.
  useEffect(() => () => onMatches(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (i: number) => {
    if (!results.length) return
    const next = (i + results.length) % results.length
    setActive(next)
    onFocus(results[next].sha)
    const el = listRef.current?.children[next] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }

  const placeholder = mode === 'content'
    ? 'Search commit contents (git log -S "…")'
    : 'Search commits by message, author, or SHA…'

  return (
    <div className="search-panel fade-in" role="dialog" aria-label="Search commits">
      <div className="search-mode-tabs">
        <button className={`search-mode ${mode === 'message' ? 'active' : ''}`} onClick={() => setMode('message')}>Message</button>
        <button className={`search-mode ${mode === 'content' ? 'active' : ''}`} onClick={() => setMode('content')}>Content</button>
        <button className="search-close" onClick={onClose} title="Close (Esc)"><Icon name="x" size={12} /></button>
      </div>

      <div className="search-input-row">
        <span className="search-icon"><Icon name="search" size={14} /></span>
        <input
          ref={inputRef}
          className="search-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose() }
            else if (e.key === 'Enter') { e.preventDefault(); if (results.length) go(active + (e.shiftKey ? -1 : 1)) }
            else if (e.key === 'ArrowDown') { e.preventDefault(); go(active + 1) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); go(active - 1) }
          }}
        />
        {searching && results.length > 0 && (
          <span className="search-count" title="Most recent match first · Enter/↓ older · ↑ newer">{active + 1} / {results.length}</span>
        )}
        {searching && results.length > 0 && (
          <span className="search-nav">
            <button onClick={() => go(active - 1)} title="Newer match (↑)"><Icon name="arrow-up" size={12} /></button>
            <button onClick={() => go(active + 1)} title="Older match (Enter / ↓)"><Icon name="arrow-down" size={12} /></button>
          </span>
        )}
        {query && (
          <button className="search-clear" onClick={() => setQuery('')} title="Clear"><Icon name="x" size={12} /></button>
        )}
      </div>

      {mode === 'content' && q.length < 2 && <div className="search-empty">Type to search commit contents</div>}
      {mode === 'content' && pickaxeLoading && <div className="search-empty">Searching…</div>}

      {results.length > 0 && (
        <div className="search-results" ref={listRef}>
          {results.slice(0, LIST_LIMIT).map((c, i) => (
            <button
              key={c.sha}
              className={`search-result-row ${i === active ? 'active' : ''}`}
              onClick={() => { setActive(i); onFocus(c.sha) }}
              onDoubleClick={onClose}
            >
              <span className="search-sha mono">{c.shortSha}</span>
              <span className="search-msg truncate">{c.message.split('\n')[0]}</span>
              <span className="search-author">{c.author}</span>
            </button>
          ))}
          {results.length > LIST_LIMIT && (
            <div className="search-footer">{results.length} matches — showing the {LIST_LIMIT} most recent here; all are lit in the graph.</div>
          )}
          {mode === 'content' && results.length >= PICKAXE_LIMIT && (
            <div className="search-footer">{PICKAXE_LIMIT} results — refine your query for more.</div>
          )}
        </div>
      )}

      {mode === 'message' && q.length >= 2 && results.length === 0 && (
        <div className="search-empty">No commits match "{query}"</div>
      )}
      {mode === 'content' && !pickaxeLoading && q.length >= 2 && results.length === 0 && (
        <div className="search-empty">No commits touched "{query}"</div>
      )}
      <div className="search-hint">Enter / ↓ older match · ↑ newer · Esc close · non-matching commits are dimmed in the graph</div>
    </div>
  )
}
