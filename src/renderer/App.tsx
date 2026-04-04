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
import { ToastContainer } from './components/Toast/Toast'
import { DiffViewer } from './components/DiffViewer/DiffViewer'
import { GitHubPanel } from './components/GitHub/GitHubPanel'
import { Welcome } from './components/Welcome/Welcome'
import { ErrorState, LoadingState, TreeIcon, NewBranchModal } from './components/AppAux/AuxComponents'
import { useGitRepo } from './hooks/useGitRepo'
import './styles/App.css'

type Modal = 'rebase' | 'worktrees' | 'bisect' | 'patch' | 'github' | 'new-branch' | null

export default function App() {
  const repo = useGitRepo()
  const [modal, setModal]             = useState<Modal>(null)
  const [showSearch, setShowSearch]   = useState(false)
  const [showWorking, setShowWorking] = useState(true)
  const [activeDiff, setActiveDiff]   = useState<{ path: string; staged: boolean } | null>(null)
  
  const { menu: ctxMenu, open: openCtx, close: closeCtx } = useContextMenu()

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); setShowSearch(true) }
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') { e.preventDefault(); repo.methods.handleOpenRepo() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') { e.preventDefault(); repo.methods.refresh() }
      if (e.key === 'Escape') { setShowSearch(false); setModal(null); closeCtx() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [repo.methods, closeCtx])

  // Auto-refresh on window focus
  useEffect(() => {
    window.addEventListener('focus', repo.methods.refresh)
    return () => window.removeEventListener('focus', repo.methods.refresh)
  }, [repo.methods.refresh])

  // Right-click on commit → context menu
  const handleCommitContextMenu = useCallback((e: React.MouseEvent, sha: string) => {
    const commit = repo.commits.find(c => c.sha === sha)
    if (!commit) return
    openCtx(e, [
      { label: 'Checkout this commit', icon: '⎇', onClick: () => repo.methods.handleCheckout(sha) },
      { label: 'Cherry-pick', icon: '⊕', onClick: async () => {
        const ok = await window.gitApi.cherryPick(sha)
        if (ok) repo.methods.refresh()
        else repo.toast.error('Cherry-pick failed', 'Could not cherry-pick this commit.')
      }},
      { separator: true, label: '', onClick: () => {} },
      { label: 'Interactive Rebase from here…', icon: '↺', onClick: () => {
        repo.setSelectedSha(sha); setModal('rebase')
      }},
      { label: 'Export Patch…', icon: '📋', onClick: () => {
        repo.setSelectedSha(sha); setModal('patch')
      }},
      { separator: true, label: '', onClick: () => {} },
      { label: 'Mark as Bisect Good', icon: '✓', onClick: () => window.gitApi.bisectGood(sha) },
      { label: 'Mark as Bisect Bad',  icon: '✗', danger: true, onClick: () => window.gitApi.bisectBad(sha) },
    ])
  }, [repo, openCtx])

  // Commits for interactive rebase start point
  const rebaseCommits = repo.selectedSha
    ? repo.commits.slice(0, repo.commits.findIndex(c => c.sha === repo.selectedSha) + 1).slice(0, 20)
    : repo.commits.slice(0, 20)

  return (
    <div className="app">
      <div className="titlebar" />

      {/* Toolbar */}
      <Toolbar
        repoPath={repo.repoPath}
        currentBranch={repo.status?.branch ?? ''}
        ahead={repo.status?.ahead ?? 0}
        behind={repo.status?.behind ?? 0}
        onFetch={repo.methods.handleFetch}
        onPull={repo.methods.handlePull}
        onPush={repo.methods.handlePush}
        onRefresh={repo.methods.refresh}
        onNewBranch={() => setModal('new-branch')}
        onSearchToggle={() => setShowSearch(true)}
        onGitHubShow={() => setModal('github')}
      />

      <div className="app-body">
        <Sidebar
          repoPath={repo.repoPath}
          branches={repo.branches}
          stashes={repo.stashes}
          remotes={repo.remotes}
          currentBranch={repo.status?.branch ?? ''}
          onCheckout={repo.methods.handleCheckout}
          onOpenRepo={repo.methods.handleOpenRepo}
          onGoHome={repo.methods.handleGoHome}
        />

        <main className="main-content">
          {!repo.repoPath ? (
            <Welcome onOpen={repo.methods.handleOpenRepo} onSelectRecent={repo.methods.loadRepo} />
          ) : repo.loading ? (
            <LoadingState />
          ) : repo.error ? (
            <ErrorState error={repo.error} onRetry={repo.methods.refresh} />
          ) : (
            <div className="graph-layout">
              {/* Left: sidebar advanced actions */}
              <div className="graph-center">
                {activeDiff ? (
                  <DiffViewer
                    filePath={activeDiff.path}
                    staged={activeDiff.staged}
                    onClose={() => setActiveDiff(null)}
                    onApplied={repo.methods.refresh}
                  />
                ) : (
                  <GraphView
                    commits={repo.commits}
                    selectedSha={repo.selectedSha}
                    onSelectCommit={repo.setSelectedSha}
                    onContextMenu={handleCommitContextMenu}
                    worktreeBranches={new Set(repo.worktrees.filter(w => !w.isMain).map(w => w.branch))}
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
                      repoPath={repo.repoPath}
                      onCommitted={repo.methods.refresh}
                      onSelectDiff={(path, staged) => {
                        setActiveDiff({ path, staged })
                        setShowWorking(true)
                      }}
                    />
                  ) : (
                    <CommitDetail sha={repo.selectedSha} commits={repo.commits} />
                  )}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Advanced feature buttons in lower sidebar */}
        {repo.repoPath && (
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
          onClose={() => { setModal(null); repo.methods.refresh() }}
        />
      )}
      {modal === 'worktrees' && (
        <Worktrees
          currentPath={repo.repoPath}
          onClose={() => setModal(null)}
          onSwitch={(path) => repo.methods.loadRepo(path)}
        />
      )}
      {modal === 'bisect' && (
        <BisectWizard commits={repo.commits} onClose={() => { setModal(null); repo.methods.refresh() }} />
      )}
      {modal === 'patch' && (
        <PatchPanel selectedSha={repo.selectedSha} onClose={() => setModal(null)} />
      )}
      {modal === 'github' && (
        <GitHubPanel 
          onClose={() => setModal(null)} 
          onRepoCreated={async (url) => {
            await window.gitApi.addRemote('origin', url)
            repo.toast.success('Repository Created', `Added remote origin to ${url}`)
            repo.methods.refresh()
          }} 
        />
      )}
      {modal === 'new-branch' && (
        <NewBranchModal
          onClose={() => setModal(null)}
          onCreate={async (name) => {
            if (name) {
              await window.gitApi.createBranch(name)
              setModal(null)
              repo.methods.refresh()
            }
          }}
        />
      )}

      {/* Search */}
      {showSearch && (
        <SearchBar
          commits={repo.commits}
          onSelect={(sha) => { repo.setSelectedSha(sha); setShowWorking(false) }}
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
      <ToastContainer toasts={repo.toast.toasts} onRemove={repo.toast.remove} />
    </div>
  )
}
