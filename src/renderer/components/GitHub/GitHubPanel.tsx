import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { GitHubUser, DeviceFlowConfig, HostedProvider } from '../../../preload'
import { GITHUB_CLIENT_ID } from '../../lib/github'
import './GitHubPanel.css'

// Integrations hub: GitHub (device-flow OAuth) plus GitLab / Bitbucket
// (token sign-in — their OAuth requires per-vendor app registration and, for
// Bitbucket, a client secret that can't ship in a binary). All three offer
// the same dashboard: user card + create-remote-repository.

interface GitHubPanelProps {
  onClose: () => void
  onRepoCreated: (url: string) => void
}

type ProviderTab = 'github' | HostedProvider

const TABS: Array<{ id: ProviderTab; label: string }> = [
  { id: 'github', label: 'GitHub' },
  { id: 'gitlab', label: 'GitLab' },
  { id: 'bitbucket', label: 'Bitbucket' },
]

export function GitHubPanel({ onClose, onRepoCreated }: GitHubPanelProps) {
  const [tab, setTab] = useState<ProviderTab>('github')

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content gh-modal" onClick={e => e.stopPropagation()}>
        <div className="gh-header">
          <h2>Integrations</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="gh-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`gh-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'github'
          ? <GitHubSection onClose={onClose} onRepoCreated={onRepoCreated} />
          : <HostedSection key={tab} provider={tab} onClose={onClose} onRepoCreated={onRepoCreated} />}
      </div>
    </div>
  )
}

// ── Shared pieces ────────────────────────────────────────────────────────────

function UserCard({ user, onDisconnect }: { user: GitHubUser; onDisconnect: () => void }) {
  return (
    <div className="gh-user">
      {user.avatar_url
        ? <img src={user.avatar_url} alt={user.login} className="gh-avatar" />
        : <div className="gh-avatar gh-avatar-fallback">{(user.name || user.login).slice(0, 1).toUpperCase()}</div>}
      <div>
        <div className="gh-name">{user.name || user.login}</div>
        <div className="gh-handle">@{user.login}</div>
      </div>
      <button className="btn btn-ghost" onClick={onDisconnect} style={{ marginLeft: 'auto' }}>Disconnect</button>
    </div>
  )
}

function CreateRepoSection({
  providerLabel,
  create,
  onRepoCreated,
  onClose,
}: {
  providerLabel: string
  create: (name: string, desc: string, isPrivate: boolean) => Promise<{ success: boolean; cloneUrl?: string; error?: string }>
  onRepoCreated: (url: string) => void
  onClose: () => void
}) {
  const [repoName, setRepoName] = useState('')
  const [repoDesc, setRepoDesc] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!repoName) return
    setCreateError('')
    setCreating(true)
    const result = await create(repoName, repoDesc, isPrivate)
    if (result.success && result.cloneUrl) {
      onRepoCreated(result.cloneUrl)
      onClose()
    } else {
      setCreateError(result.error || 'Failed to create repository')
      setCreating(false)
    }
  }

  return (
    <>
      <h3>Create Remote Repository</h3>
      <p className="gh-muted">Create a new repository on {providerLabel} and add it as a remote to your current workspace.</p>
      <form onSubmit={handleSubmit} className="gh-form">
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
    </>
  )
}

// ── GitHub (device-flow OAuth) ───────────────────────────────────────────────

function GitHubSection({ onClose, onRepoCreated }: GitHubPanelProps) {
  const [user, setUser] = useState<GitHubUser | null>(null)
  const [loading, setLoading] = useState(true)

  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowConfig | null>(null)
  const [loginError, setLoginError] = useState('')
  const [, setPolling] = useState(false)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)

  // Built-in public client ID (overridable via VITE_GITHUB_CLIENT_ID) — sign-in
  // works out of the box, no .env required.
  const clientId = GITHUB_CLIENT_ID

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
      // Take the user straight to the code-entry page; the code stays visible
      // in the modal for them to type over there.
      window.uiApi.openExternal(result.flow.verification_uri)
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
        } else if (
          result.error &&
          !result.error.includes('authorization_pending') &&
          !result.error.includes('slow_down')
        ) {
          // authorization_pending / slow_down just mean "keep waiting" — anything
          // else (expired_token, access_denied, network) ends the flow.
          if (pollingRef.current) clearInterval(pollingRef.current)
          setLoginError(result.error)
          setPolling(false)
          setDeviceFlow(null)
        }
      } catch {
        // Silently fail on network disconnects during polling
      }
    }, (flow.interval + 1) * 1000) // Poll slightly slower than limit to avoid slow_down blocks
  }

  const handleLogout = async () => {
    await window.githubApi.logout()
    setUser(null)
  }

  if (loading) {
    return (
      <div className="gh-body gh-loading">
        <div className="loading-spinner">⟳</div>
        <div>Loading GitHub session...</div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="gh-body gh-login">
        <p>Connect your GitHub account to create remote repositories directly from Git Gud.</p>

        {!deviceFlow ? (
          <div style={{ textAlign: 'center', marginTop: 30, marginBottom: 30 }}>
            <button className="btn btn-primary" onClick={startOAuthFlow}>
              Log In with GitHub
            </button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', marginTop: 20, marginBottom: 20 }}>
            <p style={{ fontSize: 16, marginBottom: 20 }}>
              Please open <a href="#" onClick={(e) => { e.preventDefault(); window.uiApi.openExternal(deviceFlow.verification_uri) }}>{deviceFlow.verification_uri}</a> and enter the code below:
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
    )
  }

  return (
    <div className="gh-body gh-dashboard">
      <UserCard user={user} onDisconnect={handleLogout} />
      <hr className="gh-divider" />
      <CreateRepoSection
        providerLabel="GitHub"
        create={async (name, desc, isPrivate) => {
          const r = await window.githubApi.createRepo(name, desc, isPrivate)
          return { success: r.success, cloneUrl: r.repo?.clone_url, error: r.error }
        }}
        onRepoCreated={onRepoCreated}
        onClose={onClose}
      />
    </div>
  )
}

// ── GitLab / Bitbucket (token sign-in) ───────────────────────────────────────

const HOSTED_META = {
  gitlab: {
    label: 'GitLab',
    tokenName: 'Personal Access Token',
    tokenHint: 'Scopes: api, write_repository',
    tokenUrl: (host: string) => `${host.replace(/\/+$/, '')}/-/user_settings/personal_access_tokens`,
  },
  bitbucket: {
    label: 'Bitbucket',
    tokenName: 'App Password / API Token',
    tokenHint: 'Permissions: Account read · Repositories read, write, admin. App passwords pair with your username; Atlassian API tokens pair with your account email.',
    tokenUrl: () => 'https://bitbucket.org/account/settings/app-passwords/',
  },
} as const

function HostedSection({
  provider,
  onClose,
  onRepoCreated,
}: GitHubPanelProps & { provider: HostedProvider }) {
  const meta = HOSTED_META[provider]
  const [user, setUser] = useState<GitHubUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [loginError, setLoginError] = useState('')

  // GitLab: host + token. Bitbucket: username + token.
  const [host, setHost] = useState('https://gitlab.com')
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')

  useEffect(() => {
    let live = true
    window.providerApi.getUser(provider).then((u) => {
      if (live) { setUser(u); setLoading(false) }
    })
    return () => { live = false }
  }, [provider])

  const handleSignIn = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError('')
    setSigningIn(true)
    const r = provider === 'gitlab'
      ? await window.providerApi.signInGitLab(host, token)
      : await window.providerApi.signInBitbucket(username, token)
    setSigningIn(false)
    if (r.success && r.user) {
      setUser(r.user)
      setToken('')
    } else {
      setLoginError(r.error || 'Sign-in failed')
    }
  }, [provider, host, username, token])

  const handleSignOut = useCallback(async () => {
    await window.providerApi.signOut(provider)
    setUser(null)
  }, [provider])

  if (loading) {
    return (
      <div className="gh-body gh-loading">
        <div className="loading-spinner">⟳</div>
        <div>Loading {meta.label} session...</div>
      </div>
    )
  }

  if (!user) {
    const canSubmit = token.trim().length > 0 && (provider === 'gitlab' ? host.trim().length > 0 : username.trim().length > 0)
    return (
      <div className="gh-body gh-login">
        <p>Connect your {meta.label} account to create remote repositories directly from Git Gud.
          {' '}Pushes and pulls to {meta.label} remotes authenticate automatically while connected.</p>
        <div className="gh-instructions">
          Create a token at{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); window.uiApi.openExternal(meta.tokenUrl(host)) }}>
            {meta.tokenUrl(provider === 'gitlab' ? host : '')}
          </a>
          <br />{meta.tokenHint}
        </div>
        <form onSubmit={handleSignIn} className="gh-form">
          {provider === 'gitlab' ? (
            <label>
              GitLab Host
              <input
                type="text"
                value={host}
                onChange={e => setHost(e.target.value)}
                placeholder="https://gitlab.com"
                spellCheck={false}
              />
            </label>
          ) : (
            <label>
              Username (or email, for API tokens)
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="your-bitbucket-username"
                spellCheck={false}
                required
              />
            </label>
          )}
          <label>
            {meta.tokenName}
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="Paste your token"
              required
            />
          </label>

          {loginError && <div className="gh-error">{loginError}</div>}

          <div style={{ marginTop: 8 }}>
            <button type="submit" className="btn btn-primary w-full" disabled={!canSubmit || signingIn}>
              {signingIn ? 'Verifying…' : `Connect ${meta.label}`}
            </button>
          </div>
        </form>
        <p className="gh-muted" style={{ marginTop: 14, marginBottom: 0 }}>
          The token is stored encrypted on this machine (never in the repo).
        </p>
      </div>
    )
  }

  return (
    <div className="gh-body gh-dashboard">
      <UserCard user={user} onDisconnect={handleSignOut} />
      <hr className="gh-divider" />
      <CreateRepoSection
        providerLabel={meta.label}
        create={async (name, desc, isPrivate) => {
          const r = await window.providerApi.createRepo(provider, name, desc, isPrivate)
          return { success: r.success, cloneUrl: r.repo?.clone_url, error: r.error }
        }}
        onRepoCreated={onRepoCreated}
        onClose={onClose}
      />
    </div>
  )
}
