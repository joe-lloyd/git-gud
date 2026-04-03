import React, { useState } from 'react'
import type { CommitNode } from '../../../preload/index'
import './BisectWizard.css'

interface BisectWizardProps {
  commits: CommitNode[]
  onClose: () => void
}

type BisectState = 'idle' | 'running' | 'done'

export const BisectWizard: React.FC<BisectWizardProps> = ({ commits, onClose }) => {
  const [state, setState] = useState<BisectState>('idle')
  const [badSha, setBadSha] = useState('')
  const [goodSha, setGoodSha] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [markedGood, setMarkedGood] = useState<Set<string>>(new Set())
  const [markedBad, setMarkedBad] = useState<Set<string>>(new Set())

  const handleStart = async () => {
    setError('')
    try {
      await window.gitApi.bisectStart()
      if (badSha) { const o = await window.gitApi.bisectBad(badSha); setOutput(o) }
      if (goodSha) {
        const o = await window.gitApi.bisectGood(goodSha)
        setOutput(o)
        setMarkedBad(new Set([badSha]))
        setMarkedGood(new Set([goodSha]))
      }
      setState('running')
    } catch (e) { setError(String(e)) }
  }

  const handleGood = async (sha: string) => {
    const o = await window.gitApi.bisectGood(sha)
    setMarkedGood((p) => new Set([...p, sha]))
    setOutput(o)
    if (o.includes('is the first bad commit')) setState('done')
  }

  const handleBad = async (sha: string) => {
    const o = await window.gitApi.bisectBad(sha)
    setMarkedBad((p) => new Set([...p, sha]))
    setOutput(o)
    if (o.includes('is the first bad commit')) setState('done')
  }

  const handleReset = async () => {
    await window.gitApi.bisectReset()
    setState('idle')
    setBadSha(''); setGoodSha(''); setOutput('')
    setMarkedGood(new Set()); setMarkedBad(new Set())
  }

  // Show only last 50 commits in the list
  const visibleCommits = commits.slice(0, 50)

  return (
    <div className="ir-overlay">
      <div className="bisect-panel fade-in">
        <div className="ir-header">
          <h2>Git Bisect</h2>
          <span className="ir-hint">Binary search for the first bad commit</span>
          <button className="ir-close" onClick={onClose}>✕</button>
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
              <div className="bisect-output mono">{output || 'Bisect started — mark commits below'}</div>
              {state === 'done' && (
                <div className="bisect-result">✅ Bug introduced found! See output above.</div>
              )}
              <div className="bisect-commit-list">
                {visibleCommits.map((c) => {
                  const isGood = markedGood.has(c.sha)
                  const isBad = markedBad.has(c.sha)
                  return (
                    <div
                      key={c.sha}
                      className={`bisect-commit-row ${isGood ? 'good' : ''} ${isBad ? 'bad' : ''}`}
                    >
                      <span className="ir-sha mono">{c.shortSha}</span>
                      <span className="ir-msg truncate">{c.message}</span>
                      {!isGood && !isBad && state === 'running' && (
                        <div className="bisect-actions">
                          <button className="bisect-btn good" onClick={() => handleGood(c.sha)}>Good ✓</button>
                          <button className="bisect-btn bad" onClick={() => handleBad(c.sha)}>Bad ✗</button>
                        </div>
                      )}
                      {isGood && <span className="bisect-tag good">✓ good</span>}
                      {isBad  && <span className="bisect-tag bad">✗ bad</span>}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <div className="ir-footer">
          <button className="btn btn-ghost" onClick={handleReset}>Reset Bisect</button>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
