import React, { useState } from 'react'
import { Icon } from '../Icons/Icon'
import './Gerrit.css'

// Gerrit-mode UI surfaces: suggestion banner, enable modal, and the
// push-for-review modal. The open changes themselves render directly in the
// commit graph (refs/gitgud/changes/* nodes) with their amendment history in
// CommitDetail — there is deliberately no separate changes panel.

// ── Suggestion banner ────────────────────────────────────────────────────────
// Shown once per repo (under the toolbar) when detection is likely and the
// mode flag is still unset. Both outcomes persist to repo git config.

export const GerritBanner: React.FC<{
  onEnable: () => void
  onDismiss: () => void
}> = ({ onEnable, onDismiss }) => (
  <div className="gerrit-banner">
    <span className="gerrit-banner-icon"><Icon name="info" size={14} /></span>
    <span className="gerrit-banner-text">
      This repo looks like it targets a <strong>Gerrit</strong> server. Enable Gerrit mode
      to push for review and see open changes?
    </span>
    <button className="btn btn-primary gerrit-banner-btn" onClick={onEnable}>Enable Gerrit mode</button>
    <button className="btn btn-ghost gerrit-banner-btn" onClick={onDismiss}>Dismiss</button>
  </div>
)

// ── Enable modal ─────────────────────────────────────────────────────────────
// Confirms/edits host + project + default target branch. Host may be left
// empty (SSH-only remotes) — the mode still enables, panel shows a setup hint.

export const GerritEnableModal: React.FC<{
  initial: { host: string; project: string; branch: string }
  onClose: () => void
  onEnable: (values: { host: string; project: string; branch: string }) => void
}> = ({ initial, onClose, onEnable }) => {
  const [host, setHost] = useState(initial.host)
  const [project, setProject] = useState(initial.project)
  const [branch, setBranch] = useState(initial.branch || 'main')

  const submit = () => onEnable({ host: host.trim().replace(/\/+$/, ''), project: project.trim(), branch: branch.trim() || 'main' })

  return (
    <div className="modal-overlay" onClick={onClose}
      style={{ zIndex: 1100, position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}>
      <div className="modal-panel fade-in"
        style={{ width: 400, padding: 24, background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}
        onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Enable Gerrit mode</h3>
        <div style={{ margin: '0 0 14px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          Stored in this repo's git config. Host is the web base URL, used for the
          open-changes list and links — leave it empty to enable without it.
        </div>
        <GerritField label="Host" placeholder="https://review.example.org" value={host} onChange={setHost} onSubmit={submit} autoFocus />
        <GerritField label="Project" placeholder="group/repo" value={project} onChange={setProject} onSubmit={submit} />
        <GerritField label="Target branch" placeholder="main" value={branch} onChange={setBranch} onSubmit={submit} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}>Enable</button>
        </div>
      </div>
    </div>
  )
}

// ── Push-for-review modal ────────────────────────────────────────────────────

export const PushForReviewModal: React.FC<{
  remote: string
  initialBranch: string
  onClose: () => void
  onPush: (opts: { targetBranch: string; topic?: string; wip?: boolean; private?: boolean }) => Promise<boolean>
}> = ({ remote, initialBranch, onClose, onPush }) => {
  const [branch, setBranch] = useState(initialBranch || 'main')
  const [topic, setTopic] = useState('')
  const [wip, setWip] = useState(false)
  const [priv, setPriv] = useState(false)
  const [pushing, setPushing] = useState(false)

  const submit = async () => {
    if (!branch.trim() || pushing) return
    setPushing(true)
    try {
      const ok = await onPush({ targetBranch: branch.trim(), topic: topic.trim() || undefined, wip, private: priv })
      if (ok) onClose()
    } finally { setPushing(false) }
  }

  const flag: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }

  return (
    <div className="modal-overlay" onClick={onClose}
      style={{ zIndex: 1100, position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}>
      <div className="modal-panel fade-in"
        style={{ width: 400, padding: 24, background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}
        onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Push for review</h3>
        <div style={{ margin: '0 0 14px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          <code>git push {remote} HEAD:refs/for/{branch.trim() || '…'}</code>
        </div>
        <GerritField label="Target branch" placeholder="main" value={branch} onChange={setBranch} onSubmit={submit} autoFocus />
        <GerritField label="Topic (optional)" placeholder="e.g. login-fix" value={topic} onChange={setTopic} onSubmit={submit} />
        <div style={{ display: 'flex', gap: 16, margin: '4px 0 0' }}>
          <label style={flag} title="Upload as work-in-progress — reviewers aren't notified.">
            <input type="checkbox" checked={wip} onChange={(e) => setWip(e.target.checked)} />
            <span>WIP</span>
          </label>
          <label style={flag} title="Only visible to you and invited reviewers.">
            <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
            <span>Private</span>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={pushing}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!branch.trim() || pushing}>
            {pushing ? 'Pushing…' : 'Push for review'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Small labelled input shared by the two modals above.
const GerritField: React.FC<{
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  autoFocus?: boolean
}> = ({ label, placeholder, value, onChange, onSubmit, autoFocus }) => (
  <label style={{ display: 'block', marginBottom: 10 }}>
    <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</span>
    <input
      autoFocus={autoFocus}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') onSubmit() }}
      style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-deepest)', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
    />
  </label>
)
