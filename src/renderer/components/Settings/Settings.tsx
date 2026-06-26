import React, { useEffect, useState } from 'react'

// ── Persisted UI settings ──────────────────────────────────────────────────
// Kept in localStorage and re-applied on every launch. Text scaling uses the
// renderer's native page zoom (webFrame) so all px-based sizes scale together.

const ZOOM_KEY = 'ui.zoomFactor'
const CONTRAST_KEY = 'ui.highContrast'

const ZOOM_MIN = 0.7
const ZOOM_MAX = 1.8
const ZOOM_STEP = 0.1

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10) / 10))

export interface Settings {
  zoom: number
  setZoom: (z: number) => void
  highContrast: boolean
  setHighContrast: (v: boolean) => void
}

export function useSettings(): Settings {
  const [zoom, setZoomState] = useState(() => {
    const v = Number(localStorage.getItem(ZOOM_KEY))
    return v >= ZOOM_MIN && v <= ZOOM_MAX ? v : 1
  })
  const [highContrast, setHighContrastState] = useState(() => localStorage.getItem(CONTRAST_KEY) === '1')

  // Apply + persist zoom. Runs on mount too, so the saved scale is restored.
  useEffect(() => {
    window.uiApi?.setZoomFactor(zoom)
    localStorage.setItem(ZOOM_KEY, String(zoom))
  }, [zoom])

  // Toggle the high-contrast token override on <html>.
  useEffect(() => {
    if (highContrast) document.documentElement.setAttribute('data-contrast', 'high')
    else document.documentElement.removeAttribute('data-contrast')
    localStorage.setItem(CONTRAST_KEY, highContrast ? '1' : '0')
  }, [highContrast])

  return {
    zoom,
    setZoom: (z) => setZoomState(clampZoom(z)),
    highContrast,
    setHighContrast: setHighContrastState,
  }
}

// ── Settings modal ──────────────────────────────────────────────────────────

interface SettingsModalProps extends Settings {
  onClose: () => void
}

export function SettingsModal({ zoom, setZoom, highContrast, setHighContrast, onClose }: SettingsModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // rerere.enabled is a per-repo git config — load on open, write on toggle.
  const [rerere, setRerere] = useState<boolean | null>(null)
  useEffect(() => {
    window.gitApi.getConfig('rerere.enabled').then((v) => setRerere(v === 'true')).catch(() => setRerere(false))
  }, [])
  const toggleRerere = (next: boolean) => {
    setRerere(next)
    window.gitApi.setConfig('rerere.enabled', next ? 'true' : 'false').catch(() => {})
  }

  const row: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 0', borderBottom: '1px solid var(--border)', gap: 16,
  }
  const labelWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 }
  const labelText: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }
  const hintText: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{ zIndex: 1100, position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}
    >
      <div
        className="modal-panel fade-in"
        style={{ width: 420, padding: 24, background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Settings</h3>

        {/* Text size */}
        <div style={row}>
          <div style={labelWrap}>
            <span style={labelText}>Text size</span>
            <span style={hintText}>Scales the whole interface.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-ghost" style={{ minWidth: 32, justifyContent: 'center' }}
              disabled={zoom <= ZOOM_MIN} onClick={() => setZoom(zoom - ZOOM_STEP)} title="Smaller">−</button>
            <span style={{ minWidth: 48, textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              {Math.round(zoom * 100)}%
            </span>
            <button className="btn btn-ghost" style={{ minWidth: 32, justifyContent: 'center' }}
              disabled={zoom >= ZOOM_MAX} onClick={() => setZoom(zoom + ZOOM_STEP)} title="Larger">+</button>
            <button className="btn btn-ghost" onClick={() => setZoom(1)} disabled={zoom === 1} title="Reset to 100%">Reset</button>
          </div>
        </div>

        {/* High contrast */}
        <div style={row}>
          <div style={labelWrap}>
            <span style={labelText}>High contrast</span>
            <span style={hintText}>Brighter text and stronger borders.</span>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={highContrast} onChange={(e) => setHighContrast(e.target.checked)} style={{ width: 'auto' }} />
          </label>
        </div>

        {/* rerere — per-repo git config */}
        <div style={row}>
          <div style={labelWrap}>
            <span style={labelText}>Reuse recorded conflict resolutions</span>
            <span style={hintText}>git rerere — auto-reapply how you resolved a conflict if it recurs.</span>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: rerere === null ? 'wait' : 'pointer' }}>
            <input
              type="checkbox"
              checked={rerere === true}
              disabled={rerere === null}
              onChange={(e) => toggleRerere(e.target.checked)}
              style={{ width: 'auto' }}
            />
          </label>
        </div>

        {/* Accent (informational) */}
        <div style={{ ...row, borderBottom: 'none' }}>
          <div style={labelWrap}>
            <span style={labelText}>Accent</span>
            <span style={hintText}>Hot neon pink (Dracula-inspired).</span>
          </div>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--accent)', border: '1px solid var(--accent-border)' }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
