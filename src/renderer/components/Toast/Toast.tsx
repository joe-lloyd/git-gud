import React, { useState, useCallback, useEffect } from 'react'
import './Toast.css'

export type ToastType = 'error' | 'warning' | 'success' | 'info'

export interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
}

let toastCounter = 0

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const add = useCallback((type: ToastType, title: string, message?: string) => {
    const id = `toast-${++toastCounter}`
    setToasts((prev) => [...prev, { id, type, title, message }])
    // Auto-dismiss after 6s (errors stay 9s)
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, type === 'error' ? 9000 : 6000)
    return id
  }, [])

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const error   = useCallback((title: string, msg?: string) => add('error',   title, msg), [add])
  const warning = useCallback((title: string, msg?: string) => add('warning', title, msg), [add])
  const success = useCallback((title: string, msg?: string) => add('success', title, msg), [add])
  const info    = useCallback((title: string, msg?: string) => add('info',    title, msg), [add])

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

  const icons: Record<ToastType, string> = {
    error:   '✕',
    warning: '⚠',
    success: '✓',
    info:    'ℹ',
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
      <span className={`toast-icon toast-icon-${toast.type}`}>{icons[toast.type]}</span>
      <div className="toast-body">
        <div className="toast-title">{toast.title}</div>
        {friendlyMessage && (
          <pre className="toast-message">{friendlyMessage}</pre>
        )}
      </div>
      <button className="toast-close" onClick={() => onRemove(toast.id)}>✕</button>
    </div>
  )
}
