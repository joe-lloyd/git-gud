import React from 'react'
import './TabBar.css'

interface TabBarProps {
  tabs: string[]
  activePath: string | null
  onActivate: (path: string) => void
  onClose: (path: string) => void
  onOpenMenu: (e: React.MouseEvent) => void
  onGoHome: () => void
  /** Running app version, shown at the bar's right edge. The native frame
   *  title carries it too, but macOS uses hiddenInset (no visible title), so
   *  this header chip is the always-visible home for it. */
  appVersion: string
  /** Updater lifecycle — turns the chip into progress / restart-to-install. */
  update: { state: 'idle' | 'downloading' | 'ready'; version?: string; percent?: number }
  /** Ready → restart-and-install; otherwise a manual update check. */
  onUpdateAction: () => void
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, activePath, onActivate, onClose, onOpenMenu, onGoHome, appVersion, update, onUpdateAction }) => {
  if (tabs.length === 0) return null
  return (
    <div className="tab-bar">
      <button
        className="tab-home"
        onClick={onGoHome}
        title="Go to start page"
        aria-label="Home"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 11l9-8 9 8" />
          <path d="M5 10v10h14V10" />
          <path d="M10 20v-6h4v6" />
        </svg>
      </button>
      {tabs.map((path) => {
        const name = path.split(/[/\\]/).filter(Boolean).pop() ?? path
        const isActive = path === activePath
        return (
          <div
            key={path}
            className={`tab ${isActive ? 'active' : ''}`}
            title={path}
            onClick={() => !isActive && onActivate(path)}
            onAuxClick={(e) => {
              // Middle-click closes
              if (e.button === 1) { e.preventDefault(); onClose(path) }
            }}
          >
            <span className="tab-name truncate">{name}</span>
            <button
              className="tab-close"
              title="Close tab"
              onClick={(e) => { e.stopPropagation(); onClose(path) }}
            >
              ×
            </button>
          </div>
        )
      })}
      <button className="tab-new" onClick={onOpenMenu} title="Open or clone a repository">
        +
      </button>
      <div className="tab-bar-spacer" />
      {appVersion && (
        <button
          className={`tab-version ${update.state === 'ready' ? 'tab-version-ready' : ''}`}
          onClick={onUpdateAction}
          title={update.state === 'ready'
            ? `Restart to install v${update.version}`
            : update.state === 'downloading'
              ? `Downloading v${update.version}…`
              : 'Check for updates'}
        >
          {update.state === 'downloading' && <>v{appVersion} → v{update.version} · {Math.round(update.percent ?? 0)}%</>}
          {update.state === 'ready' && <>↻ Restart for v{update.version}</>}
          {update.state === 'idle' && <>v{appVersion}</>}
        </button>
      )}
    </div>
  )
}
