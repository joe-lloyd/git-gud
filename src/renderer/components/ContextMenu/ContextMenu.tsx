import React, { useState } from 'react'
import './ContextMenu.css'

export interface ContextMenuAction {
  label: string
  icon?: string
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  onClick: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  actions: ContextMenuAction[]
  onClose: () => void
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, actions, onClose }) => {
  return (
    <>
      <div className="cm-backdrop" onClick={onClose} />
      <div
        className="cm-menu fade-in"
        style={{ left: x, top: y }}
        onClick={onClose}
      >
        {actions.map((a, i) =>
          a.separator ? (
            <div key={i} className="cm-sep" />
          ) : (
            <button
              key={i}
              className={`cm-item ${a.danger ? 'danger' : ''}`}
              disabled={a.disabled}
              onClick={(e) => { e.stopPropagation(); if (!a.disabled) a.onClick() }}
            >
              {a.icon && <span className="cm-icon">{a.icon}</span>}
              {a.label}
            </button>
          )
        )}
      </div>
    </>
  )
}

export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; actions: ContextMenuAction[] } | null>(null)

  const open = (e: React.MouseEvent, actions: ContextMenuAction[]) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, actions })
  }

  const close = () => setMenu(null)

  return { menu, open, close }
}
