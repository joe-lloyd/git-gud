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
import {
  ErrorState,
  LoadingState,
  TreeIcon,
  NewBranchModal,
  InputModal,
  ConfirmModal,
} from './components/AppAux/AuxComponents'
import { useGitRepo } from './hooks/useGitRepo'
import { useCommitActions, CommitActionModal } from './hooks/useCommitActions'
import './styles/App.css'

// All modal types that App.tsx manages.
// Actions that need user interaction set one of these before displaying.
type AppModal =
  | 'rebase'
  | 'worktrees'
  | 'bisect'
  | 'patch'
  | 'github'
  | 'new-branch'
  | CommitActionModal['type']  // 'branch-here' | 'tag-here' | 'confirm-reset-hard' | 'interactive-rebase'
  | null

export default function App() {
  const repo = useGitRepo()
  const [modal, setModal]             = useState<AppModal>(null)
  const [pendingSha, setPendingSha]   = useState<string | null>(null)
  const [showSearch, setShowSearch]   = useState(false)
  const [showWorking, setShowWorking] = useState(true)
  const [activeDiff, setActiveDiff]   = useState<{ path: string; staged: boolean } | null>(null)

  const { menu: ctxMenu, open: openCtx, close: closeCtx } = useContextMenu()

  // Bridge from useCommitActions → App modal state
  const openModal = useCallback((m: CommitActionModal) => {
    setPendingSha(m.sha)
    setModal(m.type)
  }, [])

  const closeModal = useCallback(() => {
    setModal(null)
    setPendingSha(null)
  }, [])

  // All isolated commit actions live in their own hook
  const actions = useCommitActions({
    toast:          repo.toast,
    methods:        repo.methods,
    openModal,
    setSelectedSha: repo.setSelectedSha,
  })

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); setShowSearch(true) }
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') { e.preventDefault(); repo.methods.handleOpenRepo() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') { e.preventDefault(); repo.methods.refresh() }
      if (e.key === 'Escape') { setShowSearch(false); closeModal(); closeCtx() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [repo.methods, closeModal, closeCtx])

  // Auto-refresh on window focus
  useEffect(() => {
    window.addEventListener('focus', repo.methods.refresh)
    return () => window.removeEventListener('focus', repo.methods.refresh)
  }, [repo.methods.refresh])

  // Build context menu entries for a right-clicked commit node
  const handleCommitContextMenu = useCallback((e: React.MouseEvent, sha: string) => {
    const commit = repo.commits.find(c => c.sha === sha)

    // Derive a usable branch name for "merge current into this":
    //   1. Prefer a local branch (no slash) — can be checked out directly
    //   2. Fall back to a remote-tracking ref (origin/ios → ios) — git will
    //      auto-create a local tracking branch on checkout if one doesn't exist yet
    const isLocal  = (r: string) => r !== 'HEAD' && !r.startsWith('tag:') && !r.includes('/')
    const isRemote = (r: string) => r !== 'HEAD' && !r.startsWith('tag:') &&  r.includes('/')
    const stripRemote = (r: string) => r.split('/').slice(1).join('/')

    const localBranch =
      commit?.refs.find(isLocal) ??
      (commit?.refs.find(isRemote) ? stripRemote(commit!.refs.find(isRemote)!) : null)

    openCtx(e, [
      { label: 'Checkout (detached HEAD)',       icon: '⎇',  onClick: () => actions.checkoutSha(sha) },
      { label: 'Create branch here…',            icon: '⎇',  onClick: () => actions.requestBranchHere(sha) },

      { separator: true, label: '', onClick: () => {} },

      { label: 'Cherry-pick',                    icon: '⊕',  onClick: () => actions.cherryPick(sha) },
      { label: 'Rebase onto this commit',        icon: '↺',  onClick: () => actions.rebaseTo(sha) },
      { label: 'Interactive rebase from here…',  icon: '↺',  onClick: () => actions.interactiveRebaseFrom(sha) },

      // ── Both merge directions ──────────────────────────────────────────
      {
        label: 'Merge this into current branch',
        icon: '⊗',
        onClick: () => actions.mergeThisIntoCurrent(sha),
      },
      {
        label: localBranch
          ? `Merge current branch into "${localBranch}"`
          : 'Merge current branch into this (no local branch)',
        icon: '⊗',
        disabled: !localBranch,
        onClick: () => localBranch && actions.mergeCurrentIntoThis(localBranch),
      },

      { separator: true, label: '', onClick: () => {} },

      { label: 'Reset → Soft',   icon: '🔄', onClick: () => actions.resetSoft(sha) },
      { label: 'Reset → Mixed',  icon: '🔄', onClick: () => actions.resetMixed(sha) },
      { label: 'Reset → Hard',   icon: '🔄', danger: true, onClick: () => actions.requestResetHard(sha) },

      { separator: true, label: '', onClick: () => {} },

      { label: 'Create tag here…', icon: '🏷', onClick: () => actions.requestTagHere(sha) },
      { label: 'Export patch…',    icon: '📋', onClick: () => { repo.setSelectedSha(sha); setModal('patch') } },

      { separator: true, label: '', onClick: () => {} },

      { label: 'Mark as Bisect Good', icon: '✓', onClick: () => window.gitApi.bisectGood(sha) },
      { label: 'Mark as Bisect Bad',  icon: '✗', danger: true, onClick: () => window.gitApi.bisectBad(sha) },

    ])
  }, [actions, repo, openCtx])

  const rebaseCommits = repo.selectedSha
    ? repo.commits.slice(0, repo.commits.findIndex(c => c.sha === repo.selectedSha) + 1).slice(0, 20)
    : repo.commits.slice(0, 20)

  return (
    <div className="app">
      <div className="titlebar" />

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

              <div className="right-panel">
                <div className="right-panel-tabs">
                  <button className={`rpt ${!showWorking ? 'active' : ''}`} onClick={() => setShowWorking(false)}>
                    Commit
                  </button>
                  <button className={`rpt ${showWorking ? 'active' : ''}`} onClick={() => setShowWorking(true)}>
                    Working Tree
                  </button>
                </div>
                <div className="right-panel-body">
                  {showWorking ? (
                    <WorkingTree
                      repoPath={repo.repoPath}
                      onCommitted={repo.methods.refresh}
                      onSelectDiff={(path, staged) => { setActiveDiff({ path, staged }); setShowWorking(true) }}
                    />
                  ) : (
                    <CommitDetail sha={repo.selectedSha} commits={repo.commits} />
                  )}
                </div>
              </div>
            </div>
          )}
        </main>

        {repo.repoPath && (
          <div className="advanced-bar">
            <button className="adv-btn" title="Interactive Rebase" onClick={() => setModal('rebase')}>↺ Rebase</button>
            <button className="adv-btn" title="Worktrees" onClick={() => setModal('worktrees')}><TreeIcon /> Trees</button>
            <button className="adv-btn" title="Bisect" onClick={() => setModal('bisect')}>⊘ Bisect</button>
            <button className="adv-btn" title="Patch" onClick={() => setModal('patch')}>⊠ Patch</button>
          </div>
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {(modal === 'rebase' || modal === 'interactive-rebase') && (
        <InteractiveRebase
          commits={rebaseCommits.map(c => ({ sha: c.sha, shortSha: c.shortSha, message: c.message }))}
          onClose={() => { closeModal(); repo.methods.refresh() }}
        />
      )}
      {modal === 'worktrees' && (
        <Worktrees currentPath={repo.repoPath} onClose={closeModal} onSwitch={repo.methods.loadRepo} />
      )}
      {modal === 'bisect' && (
        <BisectWizard commits={repo.commits} onClose={() => { closeModal(); repo.methods.refresh() }} />
      )}
      {modal === 'patch' && (
        <PatchPanel selectedSha={repo.selectedSha} onClose={closeModal} />
      )}
      {modal === 'github' && (
        <GitHubPanel
          onClose={closeModal}
          onRepoCreated={async (url) => {
            await window.gitApi.addRemote('origin', url)
            repo.toast.success('Repository Created', `Added remote origin to ${url}`)
            repo.methods.refresh()
          }}
        />
      )}
      {modal === 'new-branch' && (
        <NewBranchModal
          onClose={closeModal}
          onCreate={async (name) => {
            if (name) { await window.gitApi.createBranch(name); closeModal(); repo.methods.refresh() }
          }}
        />
      )}

      {/* Commit-node modals — all driven by pendingSha set in openModal() */}
      {modal === 'branch-here' && pendingSha && (
        <InputModal
          title={`Create Branch at ${pendingSha.slice(0, 7)}`}
          placeholder="Branch name"
          confirmLabel="Create Branch"
          onClose={closeModal}
          onConfirm={(name) => { closeModal(); actions.createBranchHere(name, pendingSha) }}
        />
      )}
      {modal === 'tag-here' && pendingSha && (
        <InputModal
          title={`Create Tag at ${pendingSha.slice(0, 7)}`}
          placeholder="Tag name (e.g. v1.2.3)"
          confirmLabel="Create Tag"
          onClose={closeModal}
          onConfirm={(name) => { closeModal(); actions.createTag(name, pendingSha) }}
        />
      )}
      {modal === 'confirm-reset-hard' && pendingSha && (
        <ConfirmModal
          title="Hard Reset"
          message={`Reset HEAD, index, and working tree to ${pendingSha.slice(0, 7)}?`}
          detail="All uncommitted changes will be permanently discarded. This cannot be undone."
          confirmLabel="Reset Hard"
          danger
          onClose={closeModal}
          onConfirm={() => actions.resetHard(pendingSha)}
        />
      )}

      {showSearch && (
        <SearchBar
          commits={repo.commits}
          onSelect={(sha) => { repo.setSelectedSha(sha); setShowWorking(false) }}
          onClose={() => setShowSearch(false)}
        />
      )}

      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} actions={ctxMenu.actions} onClose={closeCtx} />
      )}

      <ToastContainer toasts={repo.toast.toasts} onRemove={repo.toast.remove} />
    </div>
  )
}
