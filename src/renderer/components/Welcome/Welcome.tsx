import React from 'react'

interface WelcomeProps {
  onOpen: () => void
  onClone: () => void
  onSelectRecent: (path: string) => void
}

const RECENT_CAP = 10

export function Welcome({ onOpen, onClone, onSelectRecent }: WelcomeProps) {
  const [recent, setRecent] = React.useState<string[]>([])
  React.useEffect(() => { window.gitApi.getRecentProjects().then(setRecent) }, [])

  // Cap to RECENT_CAP so the list never grows past a single scrollable column.
  const visible = recent.slice(0, RECENT_CAP)

  return (
    <div className="welcome fade-in">
      {/* "The Burning Branch" — same mark as resources/icon.svg */}
      <svg className="welcome-logo" width="96" height="96" viewBox="0 0 96 96" aria-label="Git Gud logo">
        <defs>
          <radialGradient id="wlFlameP" cx="50%" cy="65%" r="60%">
            <stop offset="0%" stopColor="#ffd7ef"/>
            <stop offset="45%" stopColor="#ff2d95"/>
            <stop offset="100%" stopColor="#ff4fc3"/>
          </radialGradient>
          <radialGradient id="wlFlameO" cx="50%" cy="65%" r="60%">
            <stop offset="0%" stopColor="#ffe3c1"/>
            <stop offset="45%" stopColor="#ff9d2e"/>
            <stop offset="100%" stopColor="#fb923c"/>
          </radialGradient>
          <g id="wlFireP">
            <circle r="8.5" fill="var(--bg-base)" stroke="rgba(255,79,195,0.55)" strokeWidth="1.7"/>
            <path d="M0 -16 C4.5 -10.5 7 -7 7 -3 A7 7 0 1 1 -7 -3 C-7 -7 -4.5 -10.5 0 -16 Z" fill="#ff4fc3" opacity="0.45"/>
            <path d="M0 -9 C3 -5.5 4.2 -3.5 4.2 -0.5 A4.2 4.2 0 1 1 -4.2 -0.5 C-4.2 -3.5 -3 -5.5 0 -9 Z" fill="url(#wlFlameP)"/>
          </g>
          <g id="wlFireO">
            <circle r="8.5" fill="var(--bg-base)" stroke="rgba(251,146,60,0.6)" strokeWidth="1.7"/>
            <path d="M0 -16 C4.5 -10.5 7 -7 7 -3 A7 7 0 1 1 -7 -3 C-7 -7 -4.5 -10.5 0 -16 Z" fill="#fb923c" opacity="0.45"/>
            <path d="M0 -9 C3 -5.5 4.2 -3.5 4.2 -0.5 A4.2 4.2 0 1 1 -4.2 -0.5 C-4.2 -3.5 -3 -5.5 0 -9 Z" fill="url(#wlFlameO)"/>
          </g>
        </defs>
        <line x1="32" y1="86" x2="32" y2="17" stroke="#ff4fc3" strokeWidth="3.2" strokeLinecap="round"/>
        <path d="M32 63 C32 51 66 56 66 42" fill="none" stroke="#fb923c" strokeWidth="3.2" strokeLinecap="round"/>
        <line x1="66" y1="42" x2="66" y2="17" stroke="#fb923c" strokeWidth="3.2" strokeLinecap="round"/>
        <use href="#wlFireP" transform="translate(32,86) scale(0.62)"/>
        <use href="#wlFireP" transform="translate(32,63) scale(0.62)"/>
        <use href="#wlFireP" transform="translate(32,40) scale(0.62)"/>
        <use href="#wlFireP" transform="translate(32,17) scale(0.62)"/>
        <use href="#wlFireO" transform="translate(66,40) scale(0.62)"/>
        <use href="#wlFireO" transform="translate(66,17) scale(0.62)"/>
      </svg>
      <h1>Git Gud</h1>
      <p>A powerful, beautiful Git client with a lane-colored commit graph.</p>

      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <button className="btn btn-primary" style={{ fontSize: 14, padding: '10px 28px' }} onClick={onOpen}>
          Open Repository
        </button>
        <button className="btn btn-ghost" style={{ fontSize: 14, padding: '10px 24px' }} onClick={onClone}>
          Clone from Remote…
        </button>
      </div>
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
