import React, { useLayoutEffect, useRef, useState } from 'react'
import { Icon, IconName } from '../Icons/Icon'
import './ContextMenu.css'

export interface ContextMenuAction {
  label: string
  icon?: IconName
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

// Gap kept between the menu and the window edge.
const EDGE = 8

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, actions, onClose }) => {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  // Opened near the bottom or right edge, the menu would run off the window
  // and hide its last items. Measure it before paint and shift it back in.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)),
    })
  }, [x, y, actions])
  return (
    <>
      <div className="cm-backdrop" onClick={onClose} />
      <div
        ref={ref}
        className="cm-menu fade-in"
        style={pos}
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
              // Close BEFORE running the action: stopPropagation blocks the
              // menu-div onClose, so without this the menu lingered over
              // whatever the action opened. Long actions signal via toasts.
              onClick={(e) => { e.stopPropagation(); if (!a.disabled) { onClose(); a.onClick() } }}
            >
              {a.icon && <span className="cm-icon"><Icon name={a.icon} size={14} /></span>}
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
