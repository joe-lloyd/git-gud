import React from 'react'
import './TabBar.css'

interface TabBarProps {
  tabs: string[]
  activePath: string | null
  onActivate: (path: string) => void
  onClose: (path: string) => void
  onOpen: () => void
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, activePath, onActivate, onClose, onOpen }) => {
  if (tabs.length === 0) return null
  return (
    <div className="tab-bar">
      {tabs.map((path) => {
        const name = path.split('/').filter(Boolean).pop() ?? path
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
      <button className="tab-new" onClick={onOpen} title="Open repository">
        +
      </button>
    </div>
  )
}
