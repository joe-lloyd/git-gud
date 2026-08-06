import React, { useState, useEffect, useMemo } from 'react'
import type { RepoStatus } from '../../../preload/index'
import { Icon } from '../Icons/Icon'
import { useCopied } from '../../hooks/useCopied'
import './PatchPanel.css'

interface PatchPanelProps {
  status: RepoStatus | null
  onClose: () => void
}

interface PatchFile {
  path: string
  status: string
  untracked: boolean
}

// Status char → badge glyph + colour, matching the working-tree convention:
// new files (added / untracked) are a green +, deletes a red −.
function badge(status: string): { glyph: string; color: string } {
  if (status === 'A' || status === '?') return { glyph: '+', color: '#68d391' }
  if (status === 'D') return { glyph: '−', color: '#fc8181' }
  if (status === 'R') return { glyph: 'R', color: '#b794f4' }
  return { glyph: 'M', color: '#f6ad55' }
}

export const PatchPanel: React.FC<PatchPanelProps> = ({ status, onClose }) => {
  const [patch, setPatch] = useState('')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<'export' | 'apply'>('export')
  const [info, setInfo] = useState<{ ok: boolean; msg: string } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Deduped list of changed files. A file staged AND modified shows once; its
  // index status wins. `git diff HEAD` later captures both sides anyway.
  const files = useMemo<PatchFile[]>(() => {
    if (!status) return []
    const map = new Map<string, PatchFile>()
    for (const f of status.staged) map.set(f.path, { path: f.path, status: f.status, untracked: false })
    for (const f of status.unstaged) if (!map.has(f.path)) map.set(f.path, { path: f.path, status: f.status, untracked: false })
    for (const p of status.untracked) if (!map.has(p)) map.set(p, { path: p, status: '?', untracked: true })
    return [...map.values()].sort((a, b) => a.path.localeCompare(b.path))
  }, [status])

  // Default to everything selected whenever the file set changes.
  const fileKey = files.map((f) => f.path).join('\n')
  useEffect(() => {
    setSelected(new Set(files.map((f) => f.path)))
    setPatch('')
    setInfo(null)
  }, [fileKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
    setPatch('')
  }

  const allSelected = files.length > 0 && selected.size === files.length
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(files.map((f) => f.path)))
    setPatch('')
  }

  const handleGenerate = async () => {
    const chosen = files.filter((f) => selected.has(f.path))
    if (chosen.length === 0) return
    setLoading(true); setInfo(null)
    try {
      const tracked = chosen.filter((f) => !f.untracked).map((f) => f.path)
      const untracked = chosen.filter((f) => f.untracked).map((f) => f.path)
      const p = await window.gitApi.buildWorkingPatch(tracked, untracked)
      setPatch(p)
      if (!p.trim()) setInfo({ ok: false, msg: 'Selected files produced an empty patch.' })
    } finally { setLoading(false) }
  }

  const defaultName = () => {
    const branch = (status?.branch ?? 'changes').replace(/[/\\]/g, '-')
    return `${branch}.patch`
  }

  const handleSave = async () => {
    if (!patch.trim()) return
    setSaving(true); setInfo(null)
    try {
      const r = await window.gitApi.savePatch(patch, defaultName())
      if ('canceled' in r) return
      if (r.success) setInfo({ ok: true, msg: `Saved to ${r.path}` })
      else setInfo({ ok: false, msg: r.error })
    } finally { setSaving(false) }
  }

  const { copied, copy } = useCopied()
  const handleCopy = () => { copy(patch) }

  const handleApply = async () => {
    if (!patch.trim()) { setInfo({ ok: false, msg: 'No patch content' }); return }
    setApplying(true); setInfo(null)
    try {
      await window.gitApi.applyPatch(patch)
      setInfo({ ok: true, msg: 'Patch applied successfully!' })
    } catch (e) {
      setInfo({ ok: false, msg: String(e) })
    } finally { setApplying(false) }
  }

  return (
    <div className="patch-panel">
      <div className="patch-header">
        <h2>Patch</h2>
        <div className="patch-tabs">
          <button className={`patch-tab ${mode === 'export' ? 'active' : ''}`} onClick={() => setMode('export')}>Export</button>
          <button className={`patch-tab ${mode === 'apply'  ? 'active' : ''}`} onClick={() => setMode('apply')}>Apply</button>
        </div>
        <span style={{ flex: 1 }} />
        <button className="patch-close" onClick={onClose}><Icon name="x" size={13} /></button>
      </div>

      <div className="patch-body">
        {mode === 'export' ? (
          <>
            {files.length === 0 ? (
              <p className="patch-hint">No uncommitted changes to export.</p>
            ) : (
              <>
                <div className="patch-filebar">
                  <label className="patch-checkrow patch-checkrow--all">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                    <span>{selected.size} of {files.length} selected</span>
                  </label>
                </div>
                <div className="patch-filelist">
                  {files.map((f) => {
                    const b = badge(f.status)
                    return (
                      <label key={f.path} className="patch-checkrow">
                        <input
                          type="checkbox"
                          checked={selected.has(f.path)}
                          onChange={() => toggle(f.path)}
                        />
                        <span className="patch-badge" style={{ color: b.color, borderColor: b.color }}>{b.glyph}</span>
                        <span className="patch-filepath mono" title={f.path}>{f.path}</span>
                      </label>
                    )
                  })}
                </div>
                <div className="patch-actions">
                  <button className="btn btn-primary" onClick={handleGenerate} disabled={loading || selected.size === 0}>
                    {loading ? 'Generating…' : 'Generate Patch'}
                  </button>
                  {patch.trim() && (
                    <>
                      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving…' : 'Save patch…'}
                      </button>
                      <button className={`btn btn-ghost${copied ? ' is-copied' : ''}`} onClick={handleCopy}>
                        {copied ? 'Copied ✓' : 'Copy'}
                      </button>
                    </>
                  )}
                </div>
                {patch.trim() && (
                  <textarea className="patch-content mono" value={patch} readOnly rows={14} />
                )}
              </>
            )}
          </>
        ) : (
          <>
            <p className="patch-hint">Paste patch content below and click Apply</p>
            <textarea
              className="patch-content mono"
              value={patch}
              onChange={(e) => setPatch(e.target.value)}
              placeholder="Paste .patch content here…"
              rows={16}
            />
            <div className="patch-actions">
              <button className="btn btn-primary" onClick={handleApply} disabled={applying || !patch.trim()}>
                {applying ? 'Applying…' : 'Apply Patch'}
              </button>
            </div>
          </>
        )}
        {info && (
          <div className={`patch-status ${info.ok ? 'ok' : 'err'}`}>{info.msg}</div>
        )}
      </div>
    </div>
  )
}
