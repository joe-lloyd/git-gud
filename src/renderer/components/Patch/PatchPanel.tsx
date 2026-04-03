import React, { useState } from 'react'
import './PatchPanel.css'

interface PatchPanelProps {
  selectedSha: string | null
  onClose: () => void
}

export const PatchPanel: React.FC<PatchPanelProps> = ({ selectedSha, onClose }) => {
  const [patch, setPatch] = useState('')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [mode, setMode] = useState<'export' | 'apply'>('export')
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleExport = async () => {
    if (!selectedSha) return
    setLoading(true); setStatus(null)
    try {
      const p = await window.gitApi.formatPatch(selectedSha)
      setPatch(p)
    } finally { setLoading(false) }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(patch)
    setStatus({ ok: true, msg: 'Copied to clipboard!' })
  }

  const handleApply = async () => {
    if (!patch.trim()) { setStatus({ ok: false, msg: 'No patch content' }); return }
    setApplying(true); setStatus(null)
    try {
      await window.gitApi.applyPatch(patch)
      setStatus({ ok: true, msg: 'Patch applied successfully!' })
    } catch (e) {
      setStatus({ ok: false, msg: String(e) })
    } finally { setApplying(false) }
  }

  return (
    <div className="ir-overlay">
      <div className="patch-panel fade-in">
        <div className="ir-header">
          <h2>Patch</h2>
          <div className="patch-tabs">
            <button className={`patch-tab ${mode === 'export' ? 'active' : ''}`} onClick={() => setMode('export')}>Export</button>
            <button className={`patch-tab ${mode === 'apply'  ? 'active' : ''}`} onClick={() => setMode('apply')}>Apply</button>
          </div>
          <span style={{ flex: 1 }} />
          <button className="ir-close" onClick={onClose}>✕</button>
        </div>

        <div className="patch-body">
          {mode === 'export' ? (
            <>
              <p className="patch-hint">
                {selectedSha
                  ? `Exporting patch for commit ${selectedSha.slice(0, 7)}`
                  : 'Select a commit in the graph first'}
              </p>
              <div className="patch-actions">
                <button className="btn btn-primary" onClick={handleExport} disabled={!selectedSha || loading}>
                  {loading ? 'Generating…' : 'Generate Patch'}
                </button>
                {patch && <button className="btn btn-ghost" onClick={handleCopy}>Copy</button>}
              </div>
              {patch && (
                <textarea className="patch-content mono" value={patch} readOnly rows={16} />
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
          {status && (
            <div className={`patch-status ${status.ok ? 'ok' : 'err'}`}>{status.msg}</div>
          )}
        </div>
      </div>
    </div>
  )
}
