import React, { useState, useCallback, useEffect, useContext, createContext, useMemo } from 'react'
import { Icon, IconName } from '../Icons/Icon'
import './Toast.css'

export type ToastType = 'error' | 'warning' | 'success' | 'info' | 'progress'

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

export interface ToastApi {
  toasts: Toast[]
  add: (type: ToastType, title: string, message?: string, action?: ToastAction) => string
  remove: (id: string) => void
  error: (title: string, msg?: string, action?: ToastAction) => string
  warning: (title: string, msg?: string, action?: ToastAction) => string
  success: (title: string, msg?: string, action?: ToastAction) => string
  info: (title: string, msg?: string, action?: ToastAction) => string
  /** Spinner toast for an in-flight operation. Never auto-dismisses — settle
   *  it with `resolve()` (or `remove()` if the outcome surfaces elsewhere). */
  progress: (title: string, msg?: string) => string
  /** Settle a progress toast into a final state; arms the usual auto-dismiss. */
  resolve: (id: string, type: Exclude<ToastType, 'progress'>, title: string, msg?: string) => void
}

let toastCounter = 0

// ── Store (single instance, owned by ToastProvider) ─────────────────────────

function useToastStore(): ToastApi {
  const [toasts, setToasts] = useState<Toast[]>([])

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const armDismiss = useCallback((id: string, type: ToastType) => {
    // Auto-dismiss after 6s (errors stay 9s). Progress toasts and toasts with
    // an action stick around — the spinner/button is the point.
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, type === 'error' ? 9000 : 6000)
  }, [])

  const add = useCallback((type: ToastType, title: string, message?: string, action?: ToastAction) => {
    const id = `toast-${++toastCounter}`
    setToasts((prev) => [...prev, { id, type, title, message, action }])
    if (!action && type !== 'progress') armDismiss(id, type)
    return id
  }, [armDismiss])

  const progress = useCallback((title: string, msg?: string) => add('progress', title, msg), [add])

  const resolve = useCallback((id: string, type: Exclude<ToastType, 'progress'>, title: string, msg?: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, type, title, message: msg } : t)))
    armDismiss(id, type)
  }, [armDismiss])

  const error   = useCallback((title: string, msg?: string, action?: ToastAction) => add('error',   title, msg, action), [add])
  const warning = useCallback((title: string, msg?: string, action?: ToastAction) => add('warning', title, msg, action), [add])
  const success = useCallback((title: string, msg?: string, action?: ToastAction) => add('success', title, msg, action), [add])
  const info    = useCallback((title: string, msg?: string, action?: ToastAction) => add('info',    title, msg, action), [add])

  return useMemo(
    () => ({ toasts, add, remove, error, warning, success, info, progress, resolve }),
    [toasts, add, remove, error, warning, success, info, progress, resolve],
  )
}

// ── Provider / hook ──────────────────────────────────────────────────────────
// One store for the whole app. useToasts() used to create per-component state,
// so any toast fired outside the one component whose store reached
// <ToastContainer> silently never rendered. The context makes every caller
// share the store the container draws from.

const ToastContext = createContext<ToastApi | null>(null)

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const api = useToastStore()
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={api.toasts} onRemove={api.remove} />
    </ToastContext.Provider>
  )
}

export function useToasts(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToasts must be used inside <ToastProvider>')
  return ctx
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
    error:    'x-circle',
    warning:  'warning',
    success:  'check-circle',
    info:     'info',
    progress: 'refresh',
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
      role={toast.type === 'progress' ? 'status' : 'alert'}
    >
      <span className={`toast-icon toast-icon-${toast.type}`}>
        <Icon name={icons[toast.type]} size={15} className={toast.type === 'progress' ? 'spin' : undefined} />
      </span>
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
