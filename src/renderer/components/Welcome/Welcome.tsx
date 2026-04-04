import React from 'react'

interface WelcomeProps {
  onOpen: () => void
  onSelectRecent: (path: string) => void
}

export function Welcome({ onOpen, onSelectRecent }: WelcomeProps) {
  const [recent, setRecent] = React.useState<string[]>([])
  React.useEffect(() => { window.gitApi.getRecentProjects().then(setRecent) }, [])

  return (
    <div className="welcome fade-in">
      <div className="welcome-logo">⎇</div>
      <h1>Git Gud</h1>
      <p>A powerful, beautiful Git client with a GitKraken-inspired commit graph.</p>
      
      <button className="btn btn-primary" style={{ fontSize: 14, padding: '10px 28px', marginTop: 10 }} onClick={onOpen}>
        Open Repository
      </button>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>⌘O to open · ⌘F to search · ⌘R to refresh</p>

      {recent.length > 0 && (
        <div style={{ marginTop: 40, textAlign: 'left', width: '100%', maxWidth: 400 }}>
          <h3 style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
            Recent Repositories
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recent.map(r => {
              const name = r.split(/[/\\]/).pop() || r
              return (
                <div key={r} onClick={() => onSelectRecent(r)}
                     style={{ padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
