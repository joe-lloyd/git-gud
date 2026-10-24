import React, { useState } from 'react'
import type { CommitNode } from '../../../preload/index'
import { Icon } from '../Icons/Icon'
import './BisectWizard.css'

interface BisectWizardProps {
  commits: CommitNode[]
  onClose: () => void
  /** git checked out another commit to test; the graph should follow. */
  onStep: () => void
}

type BisectState = 'idle' | 'running' | 'done'

export const BisectWizard: React.FC<BisectWizardProps> = ({ commits, onClose, onStep }) => {
  const [state, setState] = useState<BisectState>('idle')
  const [badSha, setBadSha] = useState('')
  const [goodSha, setGoodSha] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const handleStart = async () => {
    setError('')
    try {
      await window.gitApi.bisectStart()
      // git only starts halving once it knows a bad commit. Blank means HEAD.
      await window.gitApi.bisectBad(badSha || undefined)
      setOutput(await window.gitApi.bisectGood(goodSha))
      setState('running')
      onStep()
    } catch (e) { setError(String(e)) }
  }

  // Marks the commit git checked out for testing, then git picks the next one.
  const mark = async (verdict: 'good' | 'bad') => {
    const o = verdict === 'good' ? await window.gitApi.bisectGood() : await window.gitApi.bisectBad()
    setOutput(o)
    if (o.includes('is the first bad commit')) setState('done')
    onStep()
  }

  const handleReset = async () => {
    await window.gitApi.bisectReset()
    setState('idle')
    setBadSha(''); setGoodSha(''); setOutput('')
    onStep()
  }

  // Show only last 50 commits in the list
  const visibleCommits = commits.slice(0, 50)

  return (
    <div className="bisect-panel">
      <div className="bisect-header">
        <h2>Git Bisect</h2>
        <span className="bisect-hint">Binary search for the first bad commit</span>
        <button className="bisect-close" onClick={onClose}><Icon name="x" size={13} /></button>
      </div>

      <div className="bisect-body">
          {state === 'idle' && (
            <div className="bisect-setup">
              <div className="bisect-field">
                <label>Bad commit (has the bug)</label>
                <select value={badSha} onChange={(e) => setBadSha(e.target.value)}>
                  <option value="">— Select or leave blank for HEAD —</option>
                  {visibleCommits.map((c) => (
                    <option key={c.sha} value={c.sha}>{c.shortSha} {c.message.slice(0, 60)}</option>
                  ))}
                </select>
              </div>
              <div className="bisect-field">
                <label>Good commit (known good)</label>
                <select value={goodSha} onChange={(e) => setGoodSha(e.target.value)}>
                  <option value="">— Select —</option>
                  {visibleCommits.map((c) => (
                    <option key={c.sha} value={c.sha}>{c.shortSha} {c.message.slice(0, 60)}</option>
                  ))}
                </select>
              </div>
              {error && <div className="wt-error">{error}</div>}
              <button className="btn btn-primary" onClick={handleStart} disabled={!goodSha}>
                Start Bisect
              </button>
            </div>
          )}

          {(state === 'running' || state === 'done') && (
            <>
              <div className="bisect-output mono">{output}</div>
              {state === 'done' ? (
                <div className="bisect-result"><Icon name="check-circle" size={13} /> Found the first bad commit. It's named above.</div>
              ) : (
                <div className="bisect-step">
                  <p className="bisect-step-hint">Test the commit git checked out, then mark it.</p>
                  <div className="bisect-actions">
                    <button className="bisect-btn good" onClick={() => mark('good')}>Good <Icon name="check" size={11} /></button>
                    <button className="bisect-btn bad" onClick={() => mark('bad')}>Bad <Icon name="x" size={11} /></button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

      <div className="bisect-footer">
        <button className="btn btn-ghost" onClick={handleReset}>Reset Bisect</button>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
