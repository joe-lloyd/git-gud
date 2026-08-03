import React, { useState, useCallback, useEffect } from 'react'
import { Icon, IconName } from '../Icons/Icon'
import './Toast.css'

export type ToastType = 'error' | 'warning' | 'success' | 'info'

/** Optional call-to-action button rendered inside the toast. */
export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  action?: ToastAction
}

let toastCounter = 0

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const add = useCallback((type: ToastType, title: string, message?: string, action?: ToastAction) => {
    const id = `toast-${++toastCounter}`
    setToasts((prev) => [...prev, { id, type, title, message, action }])
    // Auto-dismiss after 6s (errors stay 9s). Toasts with an action stick
    // around until dismissed — the button is the point.
    if (!action) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, type === 'error' ? 9000 : 6000)
    }
    return id
  }, [])

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const error   = useCallback((title: string, msg?: string, action?: ToastAction) => add('error',   title, msg, action), [add])
  const warning = useCallback((title: string, msg?: string, action?: ToastAction) => add('warning', title, msg, action), [add])
  const success = useCallback((title: string, msg?: string, action?: ToastAction) => add('success', title, msg, action), [add])
  const info    = useCallback((title: string, msg?: string, action?: ToastAction) => add('info',    title, msg, action), [add])

  return { toasts, add, remove, error, warning, success, info }
}

// ── Container ────────────────────────────────────────────────────────────────

interface ToastContainerProps {
  toasts: Toast[]
  onRemove: (id: string) => void
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemove }) => {
  if (toasts.length === 0) return null
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>
  )
}

// ── Item ──────────────────────────────────────────────────────────────────────

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Trigger enter animation
    requestAnimationFrame(() => setVisible(true))
  }, [])

  const icons: Record<ToastType, IconName> = {
    error:   'x-circle',
    warning: 'warning',
    success: 'check-circle',
    info:    'info',
  }

  // Parse git error messages to be more readable
  const friendlyMessage = toast.message
    ? toast.message
        .replace(/^Error: /, '')
        .replace(/^error: /, '')
        .split('\n')
        .slice(0, 6)
        .join('\n')
    : undefined

  return (
    <div
      className={`toast toast-${toast.type} ${visible ? 'toast-enter' : ''}`}
      role="alert"
    >
      <span className={`toast-icon toast-icon-${toast.type}`}><Icon name={icons[toast.type]} size={15} /></span>
      <div className="toast-body">
        <div className="toast-title">{toast.title}</div>
        {friendlyMessage && (
          <pre className="toast-message">{friendlyMessage}</pre>
        )}
        {toast.action && (
          <button
            className="toast-action"
            onClick={() => { toast.action!.onClick(); onRemove(toast.id) }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button className="toast-close" onClick={() => onRemove(toast.id)}><Icon name="x" size={12} /></button>
    </div>
  )
}
