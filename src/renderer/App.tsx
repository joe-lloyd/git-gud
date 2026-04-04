import React, { useState, useEffect, useCallback } from 'react'
import { Sidebar } from './components/Sidebar/Sidebar'
import { GraphView } from './components/Graph/GraphView'
import { CommitDetail } from './components/CommitDetail/CommitDetail'
import { Toolbar } from './components/Toolbar/Toolbar'
import { WorkingTree } from './components/WorkingTree/WorkingTree'
import { InteractiveRebase } from './components/Rebase/InteractiveRebase'
import { Worktrees } from './components/Worktrees/Worktrees'
import { BisectWizard } from './components/Bisect/BisectWizard'
import { PatchPanel } from './components/Patch/PatchPanel'
import { SearchBar } from './components/Search/SearchBar'
import { ContextMenu, useContextMenu } from './components/ContextMenu/ContextMenu'
import { ToastContainer, useToasts } from './components/Toast/Toast'
import { DiffViewer } from './components/DiffViewer/DiffViewer'
import { GitHubPanel } from './components/GitHub/GitHubPanel'
import type { CommitNode, BranchData, StashInfo, RepoStatus, WorktreeInfo } from '../preload/index'
import './styles/App.css'

type Modal = 'rebase' | 'worktrees' | 'bisect' | 'patch' | 'github' | null

const EMPTY_BRANCHES: BranchData = { local: [], remote: [] }

export default function App() {
  const [repoPath, setRepoPath]       = useState<string | null>(null)
  const [commits, setCommits]         = useState<CommitNode[]>([])
  const [branches, setBranches]       = useState<BranchData>(EMPTY_BRANCHES)
  const [stashes, setStashes]         = useState<StashInfo[]>([])
  const [worktrees, setWorktrees]      = useState<WorktreeInfo[]>([])
  const [status, setStatus]            = useState<RepoStatus | null>(null)
  const [selectedSha, setSelectedSha] = useState<string | null>(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [modal, setModal]             = useState<Modal>(null)
  const [showSearch, setShowSearch]   = useState(false)
  const [showWorking, setShowWorking] = useState(true)
  const [activeDiff, setActiveDiff]   = useState<{ path: string; staged: boolean } | null>(null)
  const toast = useToasts()
  const { menu: ctxMenu, open: openCtx, close: closeCtx } = useContextMenu()

  const handleGoHome = useCallback(() => {
    setRepoPath(null)
    setCommits([])
    setBranches(EMPTY_BRANCHES)
    setStashes([])
    setWorktrees([])
    setStatus(null)
    setSelectedSha(null)
    setError(null)
  }, [])

  const loadRepo = useCallback(async (path: string) => {
    setLoading(true); setError(null); setSelectedSha(null)
    try {
      const ok = await window.gitApi.openPath(path)
      if (!ok) throw new Error('Not a valid Git repository or path does not exist.')
      
      const [log, branchData, stashData, st, wt] = await Promise.all([
        window.gitApi.getLog(2000),
        window.gitApi.getBranches(),
        window.gitApi.getStashes(),
        window.gitApi.getStatus(),
        window.gitApi.getWorktrees(),
      ])
      window.gitApi.addRecentProject(path)
      setCommits(log)
      setBranches(branchData)
      setStashes(stashData)
      setWorktrees(wt)
      setStatus(st)
      setRepoPath(path)
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [])

  const refresh = useCallback(() => { if (repoPath) loadRepo(repoPath) }, [repoPath, loadRepo])

  const handleOpenRepo = useCallback(async () => {
    const path = await window.gitApi.openDialog()
    if (path) await loadRepo(path)
  }, [loadRepo])

  const handleCheckout = useCallback(async (branch: string) => {
    const result = await window.gitApi.checkout(branch)
    if (result.success && repoPath) await loadRepo(repoPath)
    else if (result.error) toast.error('Checkout failed', result.error)
  }, [repoPath, loadRepo, toast])

  const handleFetch  = useCallback(async () => {
    const ok = await window.gitApi.fetch()
    if (ok) refresh()
    else toast.warning('Fetch failed', 'Could not fetch from remote.')
  }, [refresh, toast])

  const handlePull   = useCallback(async () => {
    const r = await window.gitApi.pull()
    if (r.success) refresh()
    else toast.error('Pull failed', r.error)
  }, [refresh, toast])

  const handlePush   = useCallback(async () => {
    const r = await window.gitApi.push()
    if (r.success) refresh()
    else toast.error('Push failed', r.error)
  }, [refresh, toast])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); setShowSearch(true) }
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') { e.preventDefault(); handleOpenRepo() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') { e.preventDefault(); refresh() }
      if (e.key === 'Escape') { setShowSearch(false); setModal(null); closeCtx() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleOpenRepo, refresh, closeCtx])

  // Auto-refresh on window focus
  useEffect(() => {
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  // Right-click on commit → context menu
  const handleCommitContextMenu = useCallback((e: React.MouseEvent, sha: string) => {
    const commit = commits.find(c => c.sha === sha)
    if (!commit) return
    openCtx(e, [
      { label: 'Checkout this commit', icon: '⎇', onClick: () => handleCheckout(sha) },
      { label: 'Cherry-pick', icon: '⊕', onClick: async () => {
        const ok = await window.gitApi.cherryPick(sha)
        if (ok) refresh()
        else toast.error('Cherry-pick failed', 'Could not cherry-pick this commit.')
      }},
      { separator: true, label: '', onClick: () => {} },
      { label: 'Interactive Rebase from here…', icon: '↺', onClick: () => {
        setSelectedSha(sha); setModal('rebase')
      }},
      { label: 'Export Patch…', icon: '📋', onClick: () => {
        setSelectedSha(sha); setModal('patch')
      }},
      { separator: true, label: '', onClick: () => {} },
      { label: 'Mark as Bisect Good', icon: '✓', onClick: () => window.gitApi.bisectGood(sha) },
      { label: 'Mark as Bisect Bad',  icon: '✗', danger: true, onClick: () => window.gitApi.bisectBad(sha) },
    ])
  }, [commits, openCtx, handleCheckout, refresh, toast])

  const selectedCommit = commits.find(c => c.sha === selectedSha)

  // Commits for interactive rebase start point
  const rebaseCommits = selectedSha
    ? commits.slice(0, commits.findIndex(c => c.sha === selectedSha) + 1).slice(0, 20)
    : commits.slice(0, 20)

  return (
    <div className="app">
      <div className="titlebar" />

      {/* Toolbar */}
      <Toolbar
        repoPath={repoPath}
        currentBranch={status?.branch ?? ''}
        ahead={status?.ahead ?? 0}
        behind={status?.behind ?? 0}
        onFetch={handleFetch}
        onPull={handlePull}
        onPush={handlePush}
        onRefresh={refresh}
        onNewBranch={() => {
          const name = prompt('New branch name:')
          if (name) window.gitApi.createBranch(name).then(refresh)
        }}
        onSearchToggle={() => setShowSearch(true)}
        onGitHubShow={() => setModal('github')}
      />

      <div className="app-body">
        <Sidebar
          repoPath={repoPath}
          branches={branches}
          stashes={stashes}
          currentBranch={status?.branch ?? ''}
          onCheckout={handleCheckout}
          onOpenRepo={handleOpenRepo}
          onGoHome={handleGoHome}
        />

        <main className="main-content">
          {!repoPath ? (
            <Welcome onOpen={handleOpenRepo} onSelectRecent={loadRepo} />
          ) : loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={refresh} />
          ) : (
            <div className="graph-layout">
              {/* Left: sidebar advanced actions */}
              <div className="graph-center">
                {activeDiff ? (
                  <DiffViewer
                    filePath={activeDiff.path}
                    staged={activeDiff.staged}
                    onClose={() => setActiveDiff(null)}
                    onApplied={refresh}
                  />
                ) : (
                  <GraphView
                    commits={commits}
                    selectedSha={selectedSha}
                    onSelectCommit={setSelectedSha}
                    onContextMenu={handleCommitContextMenu}
                    worktreeBranches={new Set(worktrees.filter(w => !w.isMain).map(w => w.branch))}
                  />
                )}
              </div>

              {/* Right: commit detail + working tree */}
              <div className="right-panel">
                <div className="right-panel-tabs">
                  <button
                    className={`rpt ${!showWorking ? 'active' : ''}`}
                    onClick={() => setShowWorking(false)}
                  >Commit</button>
                  <button
                    className={`rpt ${showWorking ? 'active' : ''}`}
                    onClick={() => setShowWorking(true)}
                  >Working Tree</button>
                </div>
                <div className="right-panel-body">
                  {showWorking ? (
                    <WorkingTree
                      repoPath={repoPath}
                      onCommitted={refresh}
                      onSelectDiff={(path, staged) => {
                        setActiveDiff({ path, staged })
                        setShowWorking(true) // keep Working Tree tab visible
                      }}
                    />
                  ) : (
                    <CommitDetail sha={selectedSha} commits={commits} />
                  )}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Advanced feature buttons in lower sidebar */}
        {repoPath && (
          <div className="advanced-bar">
            <button className="adv-btn" title="Interactive Rebase" onClick={() => setModal('rebase')}>↺ Rebase</button>
            <button className="adv-btn" title="Worktrees" onClick={() => setModal('worktrees')}>
              <TreeIcon /> Trees
            </button>
            <button className="adv-btn" title="Bisect" onClick={() => setModal('bisect')}>⊘ Bisect</button>
            <button className="adv-btn" title="Patch" onClick={() => setModal('patch')}>⊠ Patch</button>
          </div>
        )}
      </div>

      {/* Modals */}
      {modal === 'rebase' && (
        <InteractiveRebase
          commits={rebaseCommits.map(c => ({ sha: c.sha, shortSha: c.shortSha, message: c.message }))}
          onClose={() => { setModal(null); refresh() }}
        />
      )}
      {modal === 'worktrees' && (
        <Worktrees
          currentPath={repoPath}
          onClose={() => setModal(null)}
          onSwitch={(path) => loadRepo(path)}
        />
      )}
      {modal === 'bisect' && (
        <BisectWizard commits={commits} onClose={() => { setModal(null); refresh() }} />
      )}
      {modal === 'patch' && (
        <PatchPanel selectedSha={selectedSha} onClose={() => setModal(null)} />
      )}
      {modal === 'github' && (
        <GitHubPanel 
          onClose={() => setModal(null)} 
          onRepoCreated={async (url) => {
            await window.gitApi.addRemote('origin', url)
            toast.success('Repository Created', `Added remote origin to ${url}`)
            refresh()
          }} 
        />
      )}

      {/* Search */}
      {showSearch && (
        <SearchBar
          commits={commits}
          onSelect={(sha) => { setSelectedSha(sha); setShowWorking(false) }}
          onClose={() => setShowSearch(false)}
        />
      )}

      {/* Context Menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          actions={ctxMenu.actions}
          onClose={closeCtx}
        />
      )}
      {/* Toast notifications */}
      <ToastContainer toasts={toast.toasts} onRemove={toast.remove} />
    </div>
  )
}

function Welcome({ onOpen, onSelectRecent }: { onOpen: () => void, onSelectRecent: (path: string) => void }) {
  const [recent, setRecent] = React.useState<string[]>([])
  React.useEffect(() => { window.gitApi.getRecentProjects().then(setRecent) }, [])

  return (
    <div className="welcome fade-in">
      <div className="welcome-logo">⎇</div>
      <h1>Git Gud</h1>
      <p>A powerful, beautiful Git client with a GitKraken-inspired commit graph.</p>
      
      <button className="btn btn-primary" style={{ fontSize: 14, padding: '10px 28px', marginTop: 10 }} onClick={onOpen}>
        Open Repository
      </button>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>⌘O to open · ⌘F to search · ⌘R to refresh</p>

      {recent.length > 0 && (
        <div style={{ marginTop: 40, textAlign: 'left', width: '100%', maxWidth: 400 }}>
          <h3 style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
            Recent Repositories
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recent.map(r => {
              const name = r.split(/[/\\]/).pop() || r
              return (
                <div key={r} onClick={() => onSelectRecent(r)}
                     style={{ padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function LoadingState() {
  return (
    <div className="welcome">
      <div style={{ fontSize: 32, display: 'inline-block' }} className="spin">⟳</div>
      <p>Loading repository…</p>
    </div>
  )
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="welcome">
      <div style={{ fontSize: 32, color: 'var(--danger)' }}>⚠</div>
      <p style={{ color: 'var(--danger)', maxWidth: 400, textAlign: 'center' }}>{error}</p>
      <button className="btn btn-ghost" onClick={onRetry}>Retry</button>
    </div>
  )
}

// Simple tree SVG icon (16×16, inherits currentColor)
function TreeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* trunk */}
      <line x1="8" y1="16" x2="8" y2="9" />
      {/* main branch point */}
      <line x1="8" y1="9" x2="3" y2="5" />
      <line x1="8" y1="9" x2="13" y2="5" />
      <line x1="8" y1="9" x2="8" y2="4" />
      {/* tips */}
      <circle cx="3" cy="4" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="13" cy="4" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="8" cy="3" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}
