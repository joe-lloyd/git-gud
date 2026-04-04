import React, { useState, useEffect, useRef } from 'react'
import type { GitHubUser, DeviceFlowConfig } from '../../../preload'
import './GitHubPanel.css'

interface GitHubPanelProps {
  onClose: () => void
  onRepoCreated: (url: string) => void
}

export function GitHubPanel({ onClose, onRepoCreated }: GitHubPanelProps) {
  const [user, setUser] = useState<GitHubUser | null>(null)
  const [loading, setLoading] = useState(true)
  
  // Login State
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowConfig | null>(null)
  const [loginError, setLoginError] = useState('')
  const [polling, setPolling] = useState(false)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)

  // Create Repo State
  const [repoName, setRepoName] = useState('')
  const [repoDesc, setRepoDesc] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  // Use the env provided client id, or placeholder if none
  const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID || 'MISSING_CLIENT_ID'

  useEffect(() => {
    window.githubApi.getUser().then((u) => {
      setUser(u)
      setLoading(false)
    })

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

  const startOAuthFlow = async () => {
    setLoginError('')
    setLoading(true)
    const result = await window.githubApi.startDeviceFlow(clientId)
    setLoading(false)

    if (result.success && result.flow) {
      setDeviceFlow(result.flow)
      startPolling(result.flow)
    } else {
      setLoginError(result.error || 'Failed to start device flow')
    }
  }

  const startPolling = (flow: DeviceFlowConfig) => {
    setPolling(true)
    // The device flow requires polling at the specific interval
    pollingRef.current = setInterval(async () => {
      try {
        const result = await window.githubApi.pollToken(clientId, flow.device_code)
        if (result.success && result.user) {
          // Token acquired successfully!
          if (pollingRef.current) clearInterval(pollingRef.current)
          setDeviceFlow(null)
          setPolling(false)
          setUser(result.user)
        } else if (result.error && !result.error.includes('authorization_pending')) {
          // If the error isn't pending, something went wrong (e.g. expired, or internet drop)
          if (pollingRef.current) clearInterval(pollingRef.current)
          setLoginError(result.error)
          setPolling(false)
          setDeviceFlow(null)
        }
      } catch (e: any) {
         // Silently fail on network disconnects during polling
      }
    }, (flow.interval + 1) * 1000) // Poll slightly slower than limit to avoid slow_down blocks
  }

  const handleLogout = async () => {
    await window.githubApi.logout()
    setUser(null)
  }

  const handleCreateRepo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!repoName) return
    setCreateError('')
    setCreating(true)
    
    const result = await window.githubApi.createRepo(repoName, repoDesc, isPrivate)
    if (result.success && result.repo) {
      onRepoCreated(result.repo.clone_url)
      onClose()
    } else {
      setCreateError(result.error || 'Failed to create repository')
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="modal-overlay">
        <div className="modal-content gh-modal">
          <div className="loading-spinner">⟳</div>
          <div>Loading GitHub session...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content gh-modal" onClick={e => e.stopPropagation()}>
        <div className="gh-header">
          <h2>GitHub Integration</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {!user ? (
          <div className="gh-body gh-login">
            <p>Connect your GitHub account to create remote repositories directly from Git Gud.</p>
            
            {!deviceFlow ? (
              <div style={{ textAlign: 'center', marginTop: 30, marginBottom: 30 }}>
                {clientId === 'MISSING_CLIENT_ID' && (
                  <div className="gh-error" style={{ marginBottom: 20 }}>
                    Missing VITE_GITHUB_CLIENT_ID in your `.env` file!
                  </div>
                )}
                <button 
                  className="btn btn-primary" 
                  onClick={startOAuthFlow}
                  disabled={clientId === 'MISSING_CLIENT_ID'}
                >
                  Log In with GitHub
                </button>
              </div>
            ) : (
               <div style={{ textAlign: 'center', marginTop: 20, marginBottom: 20 }}>
                 <p style={{ fontSize: 16, marginBottom: 20 }}>
                   Please open <a href="#" onClick={(e) => { e.preventDefault(); require('electron').shell.openExternal(deviceFlow.verification_uri) }}>{deviceFlow.verification_uri}</a> and enter the code below:
                 </p>
                 <div style={{ fontSize: 36, fontWeight: 'bold', letterSpacing: 4, background: 'var(--bg-base)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                   {deviceFlow.user_code}
                 </div>
                 <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                   <div className="loading-spinner" style={{ fontSize: 18 }}>⟳</div>
                   <span className="gh-muted" style={{ margin: 0 }}>Waiting for authorization...</span>
                 </div>
               </div>
            )}

            {loginError && <div className="gh-error">{loginError}</div>}
          </div>
        ) : (
          <div className="gh-body gh-dashboard">
            <div className="gh-user">
              <img src={user.avatar_url} alt={user.login} className="gh-avatar" />
              <div>
                <div className="gh-name">{user.name || user.login}</div>
                <div className="gh-handle">@{user.login}</div>
              </div>
              <button className="btn btn-ghost" onClick={handleLogout} style={{ marginLeft: 'auto' }}>Disconnect</button>
            </div>

            <hr className="gh-divider" />

            <h3>Create Remote Repository</h3>
            <p className="gh-muted">Create a new repository on GitHub and add it as a remote to your current workspace.</p>
            <form onSubmit={handleCreateRepo} className="gh-form">
              <label>
                Repository Name
                <input 
                  type="text" 
                  value={repoName} 
                  onChange={e => setRepoName(e.target.value)} 
                  placeholder="awesome-project"
                  required
                />
              </label>
              
              <label>
                Description (optional)
                <input 
                  type="text" 
                  value={repoDesc} 
                  onChange={e => setRepoDesc(e.target.value)} 
                  placeholder="My awesome project description"
                />
              </label>

              <label className="checkbox-label">
                <input 
                  type="checkbox" 
                  checked={isPrivate} 
                  onChange={e => setIsPrivate(e.target.checked)} 
                />
                Private Repository
              </label>

              {createError && <div className="gh-error">{createError}</div>}
              
              <div style={{ marginTop: 16 }}>
                <button type="submit" className="btn btn-primary w-full" disabled={!repoName || creating}>
                  {creating ? 'Creating...' : 'Create & Add Remote'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
