import React, { useState } from 'react'
import { Icon } from '../Icons/Icon'
import './TabBar.css'

// Tabs' own drag payload type — keeps tab drags from ever being read as the
// graph's ref-pill drags (and vice versa).
const TAB_DRAG_MIME = 'application/x-gitgud-tab'

interface TabBarProps {
  tabs: string[]
  activePath: string | null
  onActivate: (path: string) => void
  onClose: (path: string) => void
  /** Move the tab at `from` so it sits at `to` (indexes into `tabs`). */
  onReorder: (from: number, to: number) => void
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
  /** Name of the peer machine a tab lives on (gitgud-peer:// paths), else null. */
  peerLabelFor?: (path: string) => string | null
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, activePath, onActivate, onClose, onReorder, onOpenMenu, onGoHome, appVersion, update, onUpdateAction, peerLabelFor }) => {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  // Insertion point while dragging: 0..tabs.length (a gap, not a tab).
  const [dropIdx, setDropIdx] = useState<number | null>(null)

  const clearDrag = () => { setDragIdx(null); setDropIdx(null) }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    // Same-window drag — component state beats dataTransfer.getData (which
    // some Chromium drop targets return empty).
    const from = dragIdx
    if (from !== null && dropIdx !== null) {
      // dropIdx is a gap index; removing the dragged tab first shifts gaps
      // right of it down by one.
      const to = dropIdx > from ? dropIdx - 1 : dropIdx
      if (to !== from) onReorder(from, to)
    }
    clearDrag()
  }

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
      {tabs.map((path, i) => {
        const name = path.split(/[/\\]/).filter(Boolean).pop() ?? path
        const isActive = path === activePath
        const peer = peerLabelFor?.(path) ?? null
        // The drop indicator renders on the tab right of the gap; a drop past
        // the last tab renders on the last tab's right edge.
        const indicator = dropIdx === null || dragIdx === null ? ''
          : dropIdx === i ? ' drop-before'
          : dropIdx === tabs.length && i === tabs.length - 1 ? ' drop-after'
          : ''
        return (
          <div
            key={path}
            className={`tab ${isActive ? 'active' : ''}${dragIdx === i ? ' dragging' : ''}${indicator}${peer ? ' tab-remote' : ''}`}
            title={peer ? `${name} on ${peer}\n${path}` : path}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(TAB_DRAG_MIME, String(i))
              e.dataTransfer.effectAllowed = 'move'
              setDragIdx(i)
            }}
            onDragEnd={clearDrag}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const rect = e.currentTarget.getBoundingClientRect()
              setDropIdx(e.clientX < rect.left + rect.width / 2 ? i : i + 1)
            }}
            onDrop={handleDrop}
            onClick={() => !isActive && onActivate(path)}
            onAuxClick={(e) => {
              // Middle-click closes
              if (e.button === 1) { e.preventDefault(); onClose(path) }
            }}
          >
            {peer && <span className="tab-peer-icon" aria-label={`on ${peer}`}><Icon name="peer" size={11} /></span>}
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
