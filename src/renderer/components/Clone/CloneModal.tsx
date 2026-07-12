import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { GitHubUser, GitHubRepo, HostedProvider, CloneProgress } from '../../../preload'
import './CloneModal.css'

// Clone a repository from a remote. Two ways in:
//   • "From URL" — paste any git URL (https or scp-like). Auth for signed-in
//     hosts is injected by the main process, so private repos work too.
//   • A signed-in service (GitHub / GitLab / Bitbucket) — browse your repos and
//     pick one. Connecting an account happens in Integrations (one place for
//     auth); this modal just consumes the session.

interface CloneModalProps {
  onClose: () => void
  onCloned: (path: string) => void
  onOpenIntegrations: () => void
}

type Source = 'url' | 'github' | 'gitlab' | 'bitbucket'

const SOURCES: Array<{ id: Source; label: string }> = [
  { id: 'url', label: 'From URL' },
  { id: 'github', label: 'GitHub' },
  { id: 'gitlab', label: 'GitLab' },
  { id: 'bitbucket', label: 'Bitbucket' },
]

// Mirror of main's deriveRepoName so the folder name auto-fills as the user
// types a URL or picks a repo.
function deriveRepoName(url: string): string {
  const s = url.trim().replace(/[?#].*$/, '').replace(/[/\\]+$/, '')
  const seg = s.split(/[/:]/).pop() ?? ''
  return seg.replace(/\.git$/i, '')
}

async function loadProvider(
  source: Exclude<Source, 'url'>,
): Promise<{ user: GitHubUser | null; repos: GitHubRepo[]; error?: string }> {
  if (source === 'github') {
    const user = await window.githubApi.getUser()
    if (!user) return { user: null, repos: [] }
    const r = await window.githubApi.listRepos()
    return { user, repos: r.repos ?? [], error: r.success ? undefined : r.error }
  }
  const provider = source as HostedProvider
  const user = await window.providerApi.getUser(provider)
  if (!user) return { user: null, repos: [] }
  const r = await window.providerApi.listRepos(provider)
  return { user, repos: r.repos ?? [], error: r.success ? undefined : r.error }
}

export function CloneModal({ onClose, onCloned, onOpenIntegrations }: CloneModalProps) {
  const [source, setSource] = useState<Source>('url')
  const [url, setUrl] = useState('')
  const [parentDir, setParentDir] = useState('')
  const [name, setName] = useState('')
  // True while the folder name still mirrors the URL — once the user edits it by
  // hand we stop overwriting their choice.
  const nameEdited = useRef(false)

  const [cloning, setCloning] = useState(false)
  const [progress, setProgress] = useState<CloneProgress | null>(null)
  const [error, setError] = useState('')

  // Seed a default destination folder so the user can clone without a detour to
  // the picker.
  useEffect(() => { window.gitApi.defaultCloneDir().then(setParentDir) }, [])

  // Live clone progress.
  useEffect(() => window.gitApi.onCloneProgress(setProgress), [])

  const setUrlAndName = useCallback((next: string) => {
    setUrl(next)
    if (!nameEdited.current) setName(deriveRepoName(next))
  }, [])

  const chooseFolder = useCallback(async () => {
    const picked = await window.gitApi.cloneDialog()
    if (picked) setParentDir(picked)
  }, [])

  const canClone = url.trim().length > 0 && parentDir.trim().length > 0 && !cloning

  const handleClone = useCallback(async () => {
    if (!canClone) return
    setError('')
    setProgress(null)
    setCloning(true)
    const result = await window.gitApi.clone({ url: url.trim(), parentDir: parentDir.trim(), name: name.trim() })
    if (result.success) {
      onCloned(result.path)
      onClose()
    } else {
      setError(result.error)
      setCloning(false)
    }
  }, [canClone, url, parentDir, name, onCloned, onClose])

  return (
    <div className="modal-overlay" onClick={cloning ? undefined : onClose}>
      <div className="modal-content clone-modal" onClick={(e) => e.stopPropagation()}>
        <div className="clone-header">
          <h2>Clone Repository</h2>
          <button className="close-btn" onClick={onClose} disabled={cloning}>×</button>
        </div>

        <div className="clone-body">
          <nav className="clone-rail">
            {SOURCES.map((s) => (
              <button
                key={s.id}
                className={`clone-source ${source === s.id ? 'active' : ''}`}
                onClick={() => setSource(s.id)}
                disabled={cloning}
              >
                <SourceIcon source={s.id} />
                <span>{s.label}</span>
              </button>
            ))}
          </nav>

          <div className="clone-main">
            {source === 'url' ? (
              <div className="clone-url-pane">
                <label className="clone-field">
                  Repository URL
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrlAndName(e.target.value)}
                    placeholder="https://github.com/owner/repo.git"
                    spellCheck={false}
                    autoFocus
                    disabled={cloning}
                  />
                </label>
                <p className="clone-hint">
                  Any git URL works — https or SSH. Repos on a connected account clone
                  with your saved credentials automatically.
                </p>
              </div>
            ) : (
              <ProviderPane
                source={source}
                selectedUrl={url}
                onPick={(repo) => { nameEdited.current = false; setUrlAndName(repo.clone_url) }}
                onOpenIntegrations={onOpenIntegrations}
                disabled={cloning}
              />
            )}
          </div>
        </div>

        <div className="clone-footer">
          <div className="clone-dest">
            <label className="clone-field clone-field--grow">
              Destination folder
              <div className="clone-dest-row">
                <input type="text" value={parentDir} readOnly title={parentDir} placeholder="Choose a folder…" />
                <button className="btn btn-ghost" onClick={chooseFolder} disabled={cloning}>Browse…</button>
              </div>
            </label>
            <label className="clone-field clone-field--name">
              Folder name
              <input
                type="text"
                value={name}
                onChange={(e) => { nameEdited.current = true; setName(e.target.value) }}
                placeholder="repo"
                spellCheck={false}
                disabled={cloning}
              />
            </label>
          </div>

          {name.trim() && parentDir.trim() && (
            <div className="clone-target-preview" title={`${parentDir}/${name}`}>
              Clones into <code>{joinPreview(parentDir, name.trim())}</code>
            </div>
          )}

          {error && <div className="clone-error">{error}</div>}

          {cloning && (
            <div className="clone-progress">
              <div className="clone-progress-track">
                <div
                  className="clone-progress-bar"
                  style={{ width: `${progress?.percent ?? 0}%` }}
                />
              </div>
              <div className="clone-progress-label">
                {progress ? `${progress.phase}… ${progress.percent}%` : 'Starting clone…'}
              </div>
            </div>
          )}

          <div className="clone-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={cloning}>Cancel</button>
            <button className="btn btn-primary" onClick={handleClone} disabled={!canClone}>
              {cloning ? 'Cloning…' : 'Clone'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Provider browse pane ─────────────────────────────────────────────────────

function ProviderPane({
  source,
  selectedUrl,
  onPick,
  onOpenIntegrations,
  disabled,
}: {
  source: Exclude<Source, 'url'>
  selectedUrl: string
  onPick: (repo: GitHubRepo) => void
  onOpenIntegrations: () => void
  disabled: boolean
}) {
  const [user, setUser] = useState<GitHubUser | null>(null)
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let live = true
    setLoading(true); setError(''); setFilter('')
    loadProvider(source).then((r) => {
      if (!live) return
      setUser(r.user)
      setRepos(r.repos)
      if (r.error) setError(r.error)
      setLoading(false)
    })
    return () => { live = false }
  }, [source])

  const label = SOURCES.find((s) => s.id === source)!.label

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return repos
    return repos.filter((r) => r.full_name.toLowerCase().includes(q))
  }, [repos, filter])

  if (loading) {
    return (
      <div className="clone-provider clone-provider--center">
        <div className="loading-spinner">⟳</div>
        <div>Loading {label} repositories…</div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="clone-provider clone-provider--center">
        <SourceIcon source={source} large />
        <p className="clone-hint" style={{ textAlign: 'center', maxWidth: 280 }}>
          Connect your {label} account to browse and clone your repositories.
        </p>
        <button className="btn btn-primary" onClick={onOpenIntegrations} disabled={disabled}>
          Connect {label}…
        </button>
      </div>
    )
  }

  return (
    <div className="clone-provider">
      <input
        className="clone-search"
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={`Search ${user.login}'s repositories…`}
        spellCheck={false}
        disabled={disabled}
      />
      {error && <div className="clone-error">{error}</div>}
      <div className="clone-repo-list">
        {shown.length === 0 ? (
          <div className="clone-empty">{repos.length === 0 ? 'No repositories found.' : 'No matches.'}</div>
        ) : (
          shown.map((r) => (
            <button
              key={r.full_name}
              className={`clone-repo ${selectedUrl === r.clone_url ? 'selected' : ''}`}
              onClick={() => onPick(r)}
              disabled={disabled}
              title={r.clone_url}
            >
              <span className="clone-repo-name">{r.name}</span>
              <span className="clone-repo-full">{r.full_name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ── Icons ────────────────────────────────────────────────────────────────────

function SourceIcon({ source, large }: { source: Source; large?: boolean }) {
  const size = large ? 40 : 18
  if (source === 'url') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    )
  }
  const color = source === 'gitlab' ? '#fc6d26' : source === 'bitbucket' ? '#2684ff' : 'currentColor'
  return (
    <span
      className="clone-badge"
      style={{ color, width: size, height: size, fontSize: large ? 20 : 11 }}
      aria-hidden="true"
    >
      {source === 'github' ? 'GH' : source === 'gitlab' ? 'GL' : 'BB'}
    </span>
  )
}

// Cosmetic join for the "clones into …" preview (main does the real join).
function joinPreview(parent: string, name: string): string {
  const sep = parent.includes('\\') ? '\\' : '/'
  return `${parent.replace(/[/\\]+$/, '')}${sep}${name}`
}
