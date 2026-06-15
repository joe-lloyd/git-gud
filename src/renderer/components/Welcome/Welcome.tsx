import React from 'react'

interface WelcomeProps {
  onOpen: () => void
  onSelectRecent: (path: string) => void
}

const RECENT_CAP = 10

export function Welcome({ onOpen, onSelectRecent }: WelcomeProps) {
  const [recent, setRecent] = React.useState<string[]>([])
  React.useEffect(() => { window.gitApi.getRecentProjects().then(setRecent) }, [])

  // Cap to RECENT_CAP so the list never grows past a single scrollable column.
  const visible = recent.slice(0, RECENT_CAP)

  return (
    <div className="welcome fade-in">
      <div className="welcome-logo">⎇</div>
      <h1>Git Gud</h1>
      <p>A powerful, beautiful Git client with a GitKraken-inspired commit graph.</p>

      <button className="btn btn-primary" style={{ fontSize: 14, padding: '10px 28px', marginTop: 10 }} onClick={onOpen}>
        Open Repository
      </button>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>⌘O to open · ⌘F to search · ⌘R to refresh</p>

      {visible.length > 0 && (
        <div style={{ marginTop: 28, width: '100%', maxWidth: 420, textAlign: 'left', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <h3 style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Recent Repositories
          </h3>
          {/* Scrollable list — flex child with min-height:0 so overflow works inside .welcome's flex column. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', minHeight: 0, maxHeight: '32vh', paddingRight: 4 }}>
            {visible.map(r => {
              const name = r.split(/[/\\]/).pop() || r
              return (
                <button
                  key={r}
                  onClick={() => onSelectRecent(r)}
                  style={{
                    padding: '6px 10px',
                    background: 'var(--bg-elevated)',
                    borderRadius: 5,
                    cursor: 'pointer',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 8,
                    textAlign: 'left',
                    width: '100%',
                  }}
                  title={r}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>{name}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{r}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
