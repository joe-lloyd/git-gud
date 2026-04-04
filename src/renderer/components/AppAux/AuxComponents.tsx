import React, { useState } from 'react'

export function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="welcome">
      <div style={{ fontSize: 32, color: 'var(--danger)' }}>⚠</div>
      <p style={{ color: 'var(--danger)', maxWidth: 400, textAlign: 'center' }}>{error}</p>
      <button className="btn btn-ghost" onClick={onRetry}>Retry</button>
    </div>
  )
}

export function LoadingState() {
  return (
    <div className="welcome">
      <div style={{ fontSize: 32, display: 'inline-block' }} className="spin">⟳</div>
      <p>Loading repository…</p>
    </div>
  )
}


export function TreeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="16" x2="8" y2="9" />
      <line x1="8" y1="9" x2="3" y2="5" />
      <line x1="8" y1="9" x2="13" y2="5" />
      <line x1="8" y1="9" x2="8" y2="4" />
      <circle cx="3" cy="4" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="13" cy="4" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="8" cy="3" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}


export function NewBranchModal({ onClose, onCreate }: { onClose: () => void, onCreate: (name: string) => void }) {
  const [name, setName] = useState('')
  return (
    <div className="ir-overlay" onClick={onClose} style={{ zIndex: 1000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
      <div className="ir-panel fade-in" style={{ width: 320, padding: 20, background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', minHeight: 'auto' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 16, color: 'var(--text-primary)' }}>New Branch</h2>
        <input 
          autoFocus
          className="search-input" 
          value={name} 
          onChange={e => setName(e.target.value)} 
          onKeyDown={e => {
            if (e.key === 'Enter' && name.trim()) onCreate(name.trim())
            if (e.key === 'Escape') onClose()
          }}
          placeholder="Branch name"
          style={{ width: '100%', marginBottom: 16, boxSizing: 'border-box', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-deepest)', color: 'var(--text-primary)' }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => name.trim() && onCreate(name.trim())} disabled={!name.trim()}>Create</button>
        </div>
      </div>
    </div>
  )
}
