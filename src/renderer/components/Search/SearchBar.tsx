import React, { useState, useRef, useEffect } from 'react'
import type { CommitNode } from '../../../preload/index'
import './SearchBar.css'

interface SearchBarProps {
  commits: CommitNode[]
  onSelect: (sha: string) => void
  onClose: () => void
}

type SearchMode = 'message' | 'content'
const PICKAXE_LIMIT = 200

export const SearchBar: React.FC<SearchBarProps> = ({ commits, onSelect, onClose }) => {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('message')
  const [pickaxeResults, setPickaxeResults] = useState<CommitNode[]>([])
  const [pickaxeLoading, setPickaxeLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Pickaxe is server-side and potentially slow on large repos — debounce so
  // typing doesn't fire an IPC per keystroke. 250ms feels responsive without
  // hammering. Result set is capped at PICKAXE_LIMIT; we surface that to the
  // user when the cap is hit.
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

  const messageResults = query.trim().length < 2 ? [] : commits.filter((c) =>
    c.message.toLowerCase().includes(query.toLowerCase()) ||
    c.author.toLowerCase().includes(query.toLowerCase()) ||
    c.sha.startsWith(query.toLowerCase())
  ).slice(0, 30)

  const results = mode === 'content' ? pickaxeResults : messageResults
  const placeholder = mode === 'content'
    ? 'Search commit contents (git log -S "…")'
    : 'Search commits by message, author, or SHA…'

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-box fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="search-mode-tabs">
          <button
            className={`search-mode ${mode === 'message' ? 'active' : ''}`}
            onClick={() => setMode('message')}
          >Message</button>
          <button
            className={`search-mode ${mode === 'content' ? 'active' : ''}`}
            onClick={() => setMode('content')}
          >Content</button>
        </div>

        <div className="search-input-row">
          <span className="search-icon">🔍</span>
          <input
            ref={inputRef}
            className="search-input"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'Enter' && results[0]) { onSelect(results[0].sha); onClose() }
            }}
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery('')}>✕</button>
          )}
        </div>

        {mode === 'content' && query.trim().length < 2 && (
          <div className="search-empty">Type to search commit contents</div>
        )}

        {mode === 'content' && pickaxeLoading && (
          <div className="search-empty">Searching…</div>
        )}

        {results.length > 0 && (
          <div className="search-results">
            {results.map((c) => (
              <button
                key={c.sha}
                className="search-result-row"
                onClick={() => { onSelect(c.sha); onClose() }}
              >
                <span className="search-sha mono">{c.shortSha}</span>
                <span className="search-msg truncate">{c.message}</span>
                <span className="search-author">{c.author}</span>
              </button>
            ))}
            {mode === 'content' && results.length >= PICKAXE_LIMIT && (
              <div className="search-footer">
                {PICKAXE_LIMIT} results — refine your query for more.
              </div>
            )}
          </div>
        )}

        {mode === 'message' && query.length >= 2 && results.length === 0 && (
          <div className="search-empty">No commits match "{query}"</div>
        )}
        {mode === 'content' && !pickaxeLoading && query.trim().length >= 2 && results.length === 0 && (
          <div className="search-empty">No commits touched "{query}"</div>
        )}
      </div>
    </div>
  )
}
