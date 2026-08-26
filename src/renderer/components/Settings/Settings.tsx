import React, { useEffect, useState } from 'react'
import { PeersSection } from '../Peers/PeerModal'
import type { UsePeers } from '../../hooks/usePeers'

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

// Gerrit-mode surface: present only when a repo is open (mode loaded). The
// flag + host/project/branch persist to repo git config via useGerrit; the
// HTTP password goes to main's encrypted store and never comes back here.
export interface GerritSettings {
  mode: { enabled: boolean | null; host: string; project: string; branch: string }
  authenticated: boolean
  onToggle: (enabled: boolean) => void
  onUpdate: (patch: { host?: string; project?: string; branch?: string }) => void
  onSetAuth: (username: string, password: string) => Promise<boolean>
  onClearAuth: () => void
}

interface SettingsModalProps extends Settings {
  onClose: () => void
  gerrit?: GerritSettings | null
  /** Peer sharing (other Git Gud instances) — host-side controls. */
  peers?: UsePeers | null
}

export function SettingsModal({ zoom, setZoom, highContrast, setHighContrast, onClose, gerrit, peers }: SettingsModalProps) {
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
        style={{ width: 460, maxHeight: '86vh', overflowY: 'auto', padding: 24, background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}
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
            <input type="checkbox" checked={highContrast} onChange={(e) => setHighContrast(e.target.checked)} />
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
            />
          </label>
        </div>

        {/* Gerrit mode — per-repo git config, only shown with a repo open */}
        {gerrit && (
          <>
            <div style={row}>
              <div style={labelWrap}>
                <span style={labelText}>Gerrit mode</span>
                <span style={hintText}>Push for review + open changes for this repo.</span>
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={gerrit.mode.enabled === true}
                  onChange={(e) => gerrit.onToggle(e.target.checked)}
                />
              </label>
            </div>
            {gerrit.mode.enabled === true && <GerritSection gerrit={gerrit} row={row} hintText={hintText} />}
          </>
        )}

        {/* Peer sharing — app-wide, lives in userData */}
        {peers && <PeersSection peers={peers} row={row} labelWrap={labelWrap} labelText={labelText} hintText={hintText} />}

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

// Expanded Gerrit settings: host/project/branch inputs (committed on blur)
// plus HTTP-password credentials for authenticated REST access.
function GerritSection({ gerrit, row, hintText }: {
  gerrit: GerritSettings
  row: React.CSSProperties
  hintText: React.CSSProperties
}) {
  const [host, setHost] = useState(gerrit.mode.host)
  const [project, setProject] = useState(gerrit.mode.project)
  const [branch, setBranch] = useState(gerrit.mode.branch)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const input: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '6px 10px', border: '1px solid var(--border)',
    borderRadius: 6, background: 'var(--bg-deepest)', color: 'var(--text-primary)', fontSize: 12, outline: 'none',
  }
  const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3 }

  const saveAuth = async () => {
    if (!username.trim() || !password) return
    setSaving(true)
    try {
      const ok = await gerrit.onSetAuth(username.trim(), password)
      if (ok) { setUsername(''); setPassword('') }
    } finally { setSaving(false) }
  }

  return (
    <div style={{ ...row, display: 'block' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <label style={{ gridColumn: '1 / -1' }}>
          <span style={fieldLabel}>Host (web base URL)</span>
          <input style={input} value={host} placeholder="https://review.example.org"
            onChange={(e) => setHost(e.target.value)}
            onBlur={() => gerrit.onUpdate({ host: host.trim().replace(/\/+$/, '') })} />
        </label>
        <label>
          <span style={fieldLabel}>Project</span>
          <input style={input} value={project} placeholder="group/repo"
            onChange={(e) => setProject(e.target.value)}
            onBlur={() => gerrit.onUpdate({ project: project.trim() })} />
        </label>
        <label>
          <span style={fieldLabel}>Default target branch</span>
          <input style={input} value={branch} placeholder="main"
            onChange={(e) => setBranch(e.target.value)}
            onBlur={() => gerrit.onUpdate({ branch: branch.trim() || 'main' })} />
        </label>
      </div>

      {gerrit.authenticated ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={hintText}>Signed in for authenticated REST access.</span>
          <button className="btn btn-ghost" onClick={gerrit.onClearAuth}>Sign out</button>
        </div>
      ) : (
        <>
          <span style={{ ...hintText, display: 'block', marginBottom: 6 }}>
            Optional: username + HTTP password (Gerrit → Settings → HTTP credentials) for
            authenticated access. Stored encrypted on this machine only.
          </span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'end' }}>
            <label>
              <span style={fieldLabel}>Username</span>
              <input style={input} value={username} autoComplete="off"
                onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label>
              <span style={fieldLabel}>HTTP password</span>
              <input style={input} type="password" value={password} autoComplete="off"
                onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button className="btn btn-ghost" disabled={!username.trim() || !password || saving} onClick={saveAuth}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
