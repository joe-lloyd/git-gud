import React, { useState, useRef, useEffect } from 'react'
import type { CommitNode } from '../../../preload/index'
import './SearchBar.css'

interface SearchBarProps {
  commits: CommitNode[]
  onSelect: (sha: string) => void
  onClose: () => void
}

export const SearchBar: React.FC<SearchBarProps> = ({ commits, onSelect, onClose }) => {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const results = query.trim().length < 2 ? [] : commits.filter((c) =>
    c.message.toLowerCase().includes(query.toLowerCase()) ||
    c.author.toLowerCase().includes(query.toLowerCase()) ||
    c.sha.startsWith(query.toLowerCase())
  ).slice(0, 30)

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-box fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <span className="search-icon">🔍</span>
          <input
            ref={inputRef}
            className="search-input"
            placeholder="Search commits by message, author, or SHA…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery('')}>✕</button>
          )}
        </div>

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
          </div>
        )}
        {query.length >= 2 && results.length === 0 && (
          <div className="search-empty">No commits match "{query}"</div>
        )}
      </div>
    </div>
  )
}
