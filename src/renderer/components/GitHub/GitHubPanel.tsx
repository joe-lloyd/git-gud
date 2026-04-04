import React, { useState, useEffect } from 'react'
import type { GitHubUser } from '../../../preload'
import './GitHubPanel.css'

interface GitHubPanelProps {
  onClose: () => void
  onRepoCreated: (url: string) => void
}

export function GitHubPanel({ onClose, onRepoCreated }: GitHubPanelProps) {
  const [user, setUser] = useState<GitHubUser | null>(null)
  const [loading, setLoading] = useState(true)
  
  // Login State
  const [token, setToken] = useState('')
  const [loginError, setLoginError] = useState('')

  // Create Repo State
  const [repoName, setRepoName] = useState('')
  const [repoDesc, setRepoDesc] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    window.githubApi.getUser().then((u) => {
      setUser(u)
      setLoading(false)
    })
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError('')
    setLoading(true)
    const result = await window.githubApi.login(token)
    if (result.success && result.user) {
      setUser(result.user)
    } else {
      setLoginError(result.error || 'Login failed')
    }
    setLoading(false)
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
            <ol className="gh-instructions">
              <li>Go to <a href="#" onClick={(e) => { e.preventDefault(); require('electron').shell.openExternal('https://github.com/settings/tokens/new?scopes=repo&description=Git%20Gud') }}>GitHub Developer Settings</a></li>
              <li>Generate a new Personal Access Token (classic) with the <strong>repo</strong> scope.</li>
              <li>Paste the token below.</li>
            </ol>
            <form onSubmit={handleLogin} className="gh-form">
              <input
                type="password"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                value={token}
                onChange={e => setToken(e.target.value)}
                autoFocus
              />
              {loginError && <div className="gh-error">{loginError}</div>}
              <button type="submit" className="btn btn-primary" disabled={!token || loading}>
                Connect Account
              </button>
            </form>
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
