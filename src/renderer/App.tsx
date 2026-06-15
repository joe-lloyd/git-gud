import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Sidebar } from './components/Sidebar/Sidebar'
import { TabBar } from './components/TabBar/TabBar'
import { GraphView, WORKTREE_SHA, makeWorktreePseudoCommit } from './components/Graph/GraphView'
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
  | 'worktrees'
  | 'bisect'
  | 'patch'
  | 'github'
  | 'new-branch'
  | 'rename-branch'
  | 'confirm-delete-branch'
  | 'confirm-delete-remote-branch'
  | 'confirm-drop-stash'
  | 'branch-from-tag'
  | CommitActionModal['type']  // 'branch-here' | 'tag-here' | 'confirm-reset-hard' | 'interactive-rebase'
  | null

interface PendingRef {
  name: string
  kind: 'local' | 'remote'
}

export default function App() {
  const repo = useGitRepo()
  const [modal, setModal]                 = useState<AppModal>(null)
  const [pendingSha, setPendingSha]       = useState<string | null>(null)
  const [pendingRef, setPendingRef]       = useState<PendingRef | null>(null)
  const [pendingStash, setPendingStash]   = useState<number | null>(null)
  const [pendingTag, setPendingTag]       = useState<string | null>(null)
  const [selectedRef, setSelectedRef]     = useState<string | null>(null)
  const [showSearch, setShowSearch]       = useState(false)
  const [activeDiff, setActiveDiff]       = useState<{ path: string; staged?: boolean; sha?: string } | null>(null)

  // Right panel mode is driven by what's selected: pseudo node (or nothing
  // when the tree is dirty) → WorkingTree; any real commit → CommitDetail.
  const showWorkingTree = repo.selectedSha === WORKTREE_SHA || repo.selectedSha === null

  // A commit-mode diff is bound to its commit — if the user picks a different
  // commit, close the stale diff. Working-tree diffs (no `sha`) stay open.
  useEffect(() => {
    setActiveDiff((prev) => (prev?.sha && prev.sha !== repo.selectedSha ? null : prev))
  }, [repo.selectedSha])

  // Switching tabs swaps the whole repo context; any open diff (commit or
  // working-tree) is tied to the previous repo's files, so drop it.
  useEffect(() => {
    setActiveDiff(null)
  }, [repo.repoPath])

  const { menu: ctxMenu, open: openCtx, close: closeCtx } = useContextMenu()

  // Bridge from useCommitActions → App modal state
  const openModal = useCallback((m: CommitActionModal) => {
    setPendingSha(m.sha)
    setModal(m.type)
  }, [])

  const closeModal = useCallback(() => {
    setModal(null)
    setPendingSha(null)
    setPendingRef(null)
    setPendingStash(null)
    setPendingTag(null)
  }, [])

  // ── Sidebar handlers ────────────────────────────────────────────────
  const handleCheckoutRemote = useCallback(async (remoteRef: string) => {
    // origin/feature-x → checks out local "feature-x" tracking origin/feature-x
    // git checkout <name> auto-creates the local tracking branch when it
    // doesn't exist locally yet.
    const localName = remoteRef.split('/').slice(1).join('/')
    if (!localName) return
    await repo.methods.handleCheckout(localName)
  }, [repo.methods])

  // Prepend a synthetic "uncommitted changes" node above HEAD when the working
  // tree is dirty. The graph dashes its parent edge (same treatment as stashes)
  // so it reads as off-history. Skip when status hasn't loaded or HEAD isn't
  // in the current log window (detached / shallow / pre-first-commit).
  const displayCommits = useMemo(() => {
    if (!repo.status) return repo.commits
    const dirty =
      repo.status.staged.length +
      repo.status.unstaged.length +
      repo.status.untracked.length
    if (dirty === 0) return repo.commits
    const headIdx = repo.commits.findIndex(c => c.refs.includes('HEAD'))
    if (headIdx < 0) return repo.commits
    const pseudo = makeWorktreePseudoCommit(repo.commits[headIdx].sha, dirty)
    return [...repo.commits.slice(0, headIdx), pseudo, ...repo.commits.slice(headIdx)]
  }, [repo.commits, repo.status])

  // Default selection: when the pseudo node is present and nothing is selected,
  // land on it so the right panel opens on the working tree.
  const hasPseudo = useMemo(
    () => displayCommits.some(c => c.sha === WORKTREE_SHA),
    [displayCommits],
  )
  useEffect(() => {
    if (repo.selectedSha === null && hasPseudo) {
      repo.setSelectedSha(WORKTREE_SHA)
    }
  }, [hasPseudo, repo.selectedSha, repo.setSelectedSha])

  // Sidebar ref clicks: track the selection AND, for stashes/branches/tags
  // backed by a SHA in the current log window, jump the graph to that node.
  const handleSelectRef = useCallback((ref: string | null) => {
    setSelectedRef(ref)
    if (!ref) return
    const [kind, ...rest] = ref.split(':')
    const name = rest.join(':')
    let sha: string | undefined
    if (kind === 'stash') {
      sha = repo.stashes.find(s => String(s.index) === name)?.sha
    } else if (kind === 'local') {
      sha = repo.branches.local.find(b => b.name === name)?.sha
    } else if (kind === 'remote') {
      sha = repo.branches.remote.find(b => b.name === name)?.sha
    } else if (kind === 'tag') {
      sha = repo.tags.find(t => t.name === name)?.sha
    }
    if (sha) repo.setSelectedSha(sha)
  }, [repo])

  const handleApplyStash = useCallback(async (index: number) => {
    const r = await window.gitApi.stashApply(index)
    if (r.success) {
      repo.toast.success('Stash Applied', `stash@{${index}} applied to working tree.`)
      repo.methods.refresh()
    } else {
      repo.toast.error('Apply Stash Failed', r.error)
    }
  }, [repo.toast, repo.methods])

  const handlePopStash = useCallback(async (index: number) => {
    const r = await window.gitApi.stashPop(index)
    if (r.success) {
      repo.toast.success('Stash Popped', `stash@{${index}} applied and removed.`)
      repo.methods.refresh()
    } else {
      repo.toast.error('Pop Stash Failed', r.error)
    }
  }, [repo.toast, repo.methods])

  const handleDropStash = useCallback(async (index: number) => {
    const r = await window.gitApi.stashDrop(index)
    if (r.success) {
      repo.toast.success('Stash Dropped', `stash@{${index}} deleted.`)
      repo.methods.refresh()
    } else {
      repo.toast.error('Drop Stash Failed', r.error)
    }
  }, [repo.toast, repo.methods])

  const handleDeleteBranch = useCallback(async (name: string, force: boolean) => {
    const r = await window.gitApi.deleteBranch(name, force)
    if (r.success) {
      repo.toast.success('Branch Deleted', `"${name}" removed.`)
      repo.methods.refresh()
    } else {
      // If `git branch -d` rejects an unmerged branch, fall through to force prompt
      if (!force && /not fully merged|not merged/i.test(r.error)) {
        setPendingRef({ name, kind: 'local' })
        setModal('confirm-delete-branch')
      } else {
        repo.toast.error('Delete Branch Failed', r.error)
      }
    }
  }, [repo.toast, repo.methods])

  const handleRenameBranch = useCallback(async (oldName: string, newName: string) => {
    const r = await window.gitApi.renameBranch(oldName, newName)
    if (r.success) {
      repo.toast.success('Branch Renamed', `"${oldName}" → "${newName}".`)
      repo.methods.refresh()
    } else {
      repo.toast.error('Rename Failed', r.error)
    }
  }, [repo.toast, repo.methods])

  const handleDeleteRemoteBranch = useCallback(async (remoteRef: string) => {
    const [remote, ...rest] = remoteRef.split('/')
    const branch = rest.join('/')
    if (!remote || !branch) return
    const r = await window.gitApi.deleteRemoteBranch(remote, branch)
    if (r.success) {
      repo.toast.success('Remote Branch Deleted', `${remoteRef} removed.`)
      repo.methods.refresh()
    } else {
      repo.toast.error('Delete Remote Branch Failed', r.error)
    }
  }, [repo.toast, repo.methods])

  const handleCreateBranchFromTag = useCallback((tagName: string) => {
    setPendingTag(tagName)
    setModal('branch-from-tag')
  }, [])

  // ── Sidebar context-menu factories ─────────────────────────────────
  const handleBranchContextMenu = useCallback(
    (e: React.MouseEvent, branchName: string, kind: 'local' | 'remote') => {
      if (kind === 'local') {
        const isCurrent = repo.status?.branch === branchName
        openCtx(e, [
          { label: `Checkout "${branchName}"`,       icon: '⎇',  disabled: isCurrent, onClick: () => repo.methods.handleCheckout(branchName) },
          { label: `Rename "${branchName}"…`,        icon: '✎',  onClick: () => { setPendingRef({ name: branchName, kind }); setModal('rename-branch') } },
          { label: `Delete "${branchName}"`,         icon: '🗑',  danger: true, disabled: isCurrent, onClick: () => handleDeleteBranch(branchName, false) },
          { separator: true, label: '', onClick: () => {} },
          { label: 'Push to remote',                 icon: '↑',  onClick: () => repo.methods.handlePush() },
          { label: 'Pull from remote',               icon: '↓',  onClick: () => repo.methods.handlePull() },
          { separator: true, label: '', onClick: () => {} },
          { label: 'Copy branch name',               icon: '⎘',  onClick: () => navigator.clipboard.writeText(branchName) },
        ])
      } else {
        const shortName = branchName.split('/').slice(1).join('/')
        openCtx(e, [
          { label: `Checkout "${shortName}" (track)`, icon: '⎇',  onClick: () => handleCheckoutRemote(branchName) },
          { label: `Delete remote "${branchName}"`,   icon: '🗑',  danger: true, onClick: () => { setPendingRef({ name: branchName, kind }); setModal('confirm-delete-remote-branch') } },
          { separator: true, label: '', onClick: () => {} },
          { label: 'Copy ref name',                   icon: '⎘',  onClick: () => navigator.clipboard.writeText(branchName) },
        ])
      }
    },
    [openCtx, repo.status, repo.methods, handleDeleteBranch, handleCheckoutRemote],
  )

  const handleStashContextMenu = useCallback(
    (e: React.MouseEvent, index: number) => {
      openCtx(e, [
        { label: 'Apply stash',                icon: '↧',  onClick: () => handleApplyStash(index) },
        { label: 'Pop stash',                  icon: '↥',  onClick: () => handlePopStash(index) },
        { separator: true, label: '', onClick: () => {} },
        { label: 'Drop stash',                 icon: '🗑',  danger: true, onClick: () => { setPendingStash(index); setModal('confirm-drop-stash') } },
      ])
    },
    [openCtx, handleApplyStash, handlePopStash],
  )

  const handleTagContextMenu = useCallback(
    (e: React.MouseEvent, tagName: string) => {
      openCtx(e, [
        { label: `Create branch from "${tagName}"…`, icon: '⎇', onClick: () => handleCreateBranchFromTag(tagName) },
        { separator: true, label: '', onClick: () => {} },
        { label: 'Copy tag name', icon: '⎘', onClick: () => navigator.clipboard.writeText(tagName) },
      ])
    },
    [openCtx, handleCreateBranchFromTag],
  )

  const handleWorktreeContextMenu = useCallback(
    (e: React.MouseEvent, path: string, isMain: boolean) => {
      const name = path.split('/').pop() || path
      const isCurrent = path === repo.repoPath
      openCtx(e, [
        { label: `Switch to "${name}"`, icon: '⎇', disabled: isCurrent, onClick: () => repo.methods.loadRepo(path) },
        { separator: true, label: '', onClick: () => {} },
        { label: 'Manage worktrees…', icon: '⊞', onClick: () => setModal('worktrees') },
        { separator: true, label: '', onClick: () => {} },
        {
          label: `Remove worktree`,
          icon: '🗑',
          danger: true,
          disabled: isMain || isCurrent,
          onClick: async () => {
            const r = await window.gitApi.removeWorktree(path)
            if (r.success) { repo.toast.success('Worktree Removed', name); repo.methods.refresh() }
            else repo.toast.error('Remove Failed', r.error)
          },
        },
        { separator: true, label: '', onClick: () => {} },
        { label: 'Copy path', icon: '⎘', onClick: () => navigator.clipboard.writeText(path) },
      ])
    },
    [openCtx, repo.repoPath, repo.methods, repo.toast],
  )

  // Right-click on a branch pill in the graph — reuse the sidebar factory
  const handleRefContextMenu = useCallback(
    (e: React.MouseEvent, ref: string, kind: 'local' | 'remote' | 'tag') => {
      if (kind === 'tag') {
        handleTagContextMenu(e, ref)
      } else {
        handleBranchContextMenu(e, ref, kind)
      }
    },
    [handleBranchContextMenu, handleTagContextMenu],
  )

  // Drag a pill onto another pill (or onto a sidebar branch row) → ask which action
  const runDragAction = useCallback(
    async (source: string, target: string, action: 'merge' | 'rebase' | 'checkout') => {
      // Normalize remote refs to their tracking branch name for git ops
      const stripRemote = (r: string) => r.includes('/') ? r.split('/').slice(1).join('/') : r
      const src = stripRemote(source)
      const tgt = stripRemote(target)
      const r = await window.gitApi.runDragAction(src, tgt, action)
      if (r.success) {
        const stashNote = r.autoStashed ? ' (changes auto-stashed and restored)' : ''
        const verb =
          action === 'merge' ? `Merged "${src}" into "${tgt}"`
          : action === 'rebase' ? `Rebased "${src}" onto "${tgt}"`
          : `Checked out "${tgt}"`
        repo.toast.success('Done', `${verb}.${stashNote}`)
        repo.methods.refresh()
      } else {
        repo.toast.error(`${action[0].toUpperCase()}${action.slice(1)} Failed`, r.error)
      }
    },
    [repo.toast, repo.methods],
  )

  const handleRefDrop = useCallback(
    (e: React.MouseEvent, source: string, target: string) => {
      if (source === target) return
      const sourceShort = source.includes('/') ? source.split('/').slice(1).join('/') : source
      const targetShort = target.includes('/') ? target.split('/').slice(1).join('/') : target
      openCtx(e, [
        { label: `Merge "${sourceShort}" → "${targetShort}"`, icon: '⊗', onClick: () => runDragAction(source, target, 'merge') },
        { label: `Rebase "${sourceShort}" onto "${targetShort}"`, icon: '↺', onClick: () => runDragAction(source, target, 'rebase') },
        { separator: true, label: '', onClick: () => {} },
        { label: `Checkout "${targetShort}"`, icon: '⎇', onClick: () => runDragAction(source, target, 'checkout') },
      ])
    },
    [openCtx, runDragAction],
  )

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

  // (focus + FS-watcher refresh handled inside useGitRepo)

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
      { label: 'Revert commit',                  icon: '↶',  onClick: () => actions.revert(sha) },
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

      <TabBar
        tabs={repo.openTabs}
        activePath={repo.repoPath}
        onActivate={repo.methods.switchTab}
        onClose={repo.methods.closeTab}
        onOpen={repo.methods.handleOpenRepo}
        onGoHome={repo.methods.handleGoHome}
      />

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
          tags={repo.tags}
          remotes={repo.remotes}
          worktrees={repo.worktrees}
          currentBranch={repo.status?.branch ?? ''}
          selectedRef={selectedRef}
          onSelectRef={handleSelectRef}
          onCheckout={repo.methods.handleCheckout}
          onCheckoutRemote={handleCheckoutRemote}
          onApplyStash={handleApplyStash}
          onCreateBranchFromTag={handleCreateBranchFromTag}
          onOpenRepo={repo.methods.handleOpenRepo}
          onGoHome={repo.methods.handleGoHome}
          onBranchContextMenu={handleBranchContextMenu}
          onStashContextMenu={handleStashContextMenu}
          onTagContextMenu={handleTagContextMenu}
          onWorktreeClick={repo.methods.loadRepo}
          onWorktreeContextMenu={handleWorktreeContextMenu}
          onWorktreeManage={() => setModal('worktrees')}
          onRefDrop={handleRefDrop}
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
                    sha={activeDiff.sha ?? null}
                    onClose={() => setActiveDiff(null)}
                    onApplied={repo.methods.refresh}
                  />
                ) : (
                  <GraphView
                    commits={displayCommits}
                    selectedSha={repo.selectedSha}
                    onSelectCommit={repo.setSelectedSha}
                    onContextMenu={handleCommitContextMenu}
                    onRefContextMenu={handleRefContextMenu}
                    onRefDrop={handleRefDrop}
                    worktreeBranches={new Set(repo.worktrees.filter(w => !w.isMain).map(w => w.branch))}
                    stashes={repo.stashes}
                  />
                )}
              </div>

              <div className="right-panel">
                <div className="right-panel-body">
                  {modal === 'bisect' ? (
                    <BisectWizard
                      commits={repo.commits}
                      onClose={() => { closeModal(); repo.methods.refresh() }}
                    />
                  ) : showWorkingTree ? (
                    <WorkingTree
                      repoPath={repo.repoPath}
                      onCommitted={repo.methods.refresh}
                      onSelectDiff={(path, staged) => setActiveDiff({ path, staged })}
                    />
                  ) : (
                    <CommitDetail
                      sha={repo.selectedSha}
                      commits={repo.commits}
                      selectedFile={activeDiff?.sha === repo.selectedSha ? activeDiff.path : null}
                      onSelectFile={(path, sha) => {
                        setActiveDiff((prev) =>
                          prev && prev.sha === sha && prev.path === path
                            ? null
                            : { path, sha }
                        )
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </main>

        {repo.repoPath && (
          <div className="advanced-bar">
            <button className="adv-btn" title="Bisect" onClick={() => setModal('bisect')}>⊘ Bisect</button>
            <button className="adv-btn" title="Patch" onClick={() => setModal('patch')}>⊠ Patch</button>
          </div>
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {modal === 'interactive-rebase' && (
        <InteractiveRebase
          commits={rebaseCommits.map(c => ({ sha: c.sha, shortSha: c.shortSha, message: c.message }))}
          onClose={() => { closeModal(); repo.methods.refresh() }}
        />
      )}
      {modal === 'worktrees' && (
        <Worktrees currentPath={repo.repoPath} onClose={closeModal} onSwitch={repo.methods.loadRepo} />
      )}
      {modal === 'patch' && (
        <PatchPanel selectedSha={repo.selectedSha} onClose={closeModal} />
      )}
      {modal === 'github' && (
        <GitHubPanel
          onClose={closeModal}
          onRepoCreated={async (url) => {
            const r = await window.gitApi.addRemote('origin', url)
            if (r.success) {
              repo.toast.success('Repository Created', `Added remote origin to ${url}`)
              repo.methods.refresh()
            } else {
              repo.toast.error('Add Remote Failed', r.error)
            }
          }}
        />
      )}
      {modal === 'new-branch' && (
        <NewBranchModal
          onClose={closeModal}
          onCreate={async (name) => {
            if (!name) return
            const r = await window.gitApi.createBranch(name)
            closeModal()
            if (r.success) { repo.toast.success('Branch Created', name); repo.methods.refresh() }
            else repo.toast.error('Branch Failed', r.error)
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
      {modal === 'rename-branch' && pendingRef && (
        <InputModal
          title={`Rename "${pendingRef.name}"`}
          placeholder="New branch name"
          confirmLabel="Rename"
          onClose={closeModal}
          onConfirm={(newName) => {
            const oldName = pendingRef.name
            closeModal()
            handleRenameBranch(oldName, newName)
          }}
        />
      )}
      {modal === 'confirm-delete-branch' && pendingRef && (
        <ConfirmModal
          title="Force-delete branch"
          message={`"${pendingRef.name}" is not fully merged.`}
          detail="Force-delete will discard any unique commits on this branch. This cannot be undone."
          confirmLabel="Force Delete"
          danger
          onClose={closeModal}
          onConfirm={() => handleDeleteBranch(pendingRef.name, true)}
        />
      )}
      {modal === 'confirm-delete-remote-branch' && pendingRef && (
        <ConfirmModal
          title="Delete remote branch"
          message={`Delete "${pendingRef.name}" from the remote?`}
          detail="This pushes a delete to the remote. Anyone else watching the branch will lose their reference to it on next fetch."
          confirmLabel="Delete Remote Branch"
          danger
          onClose={closeModal}
          onConfirm={() => handleDeleteRemoteBranch(pendingRef.name)}
        />
      )}
      {modal === 'confirm-drop-stash' && pendingStash !== null && (
        <ConfirmModal
          title="Drop stash"
          message={`Drop stash@{${pendingStash}}?`}
          detail="The stash contents will be permanently discarded. This cannot be undone."
          confirmLabel="Drop Stash"
          danger
          onClose={closeModal}
          onConfirm={() => handleDropStash(pendingStash)}
        />
      )}
      {modal === 'branch-from-tag' && pendingTag && (
        <InputModal
          title={`Create branch from tag "${pendingTag}"`}
          placeholder="Branch name"
          confirmLabel="Create Branch"
          onClose={closeModal}
          onConfirm={async (name) => {
            const tag = pendingTag
            closeModal()
            const r = await window.gitApi.createBranch(name, tag)
            if (r.success) { repo.toast.success('Branch Created', `${name} at ${tag}`); repo.methods.refresh() }
            else repo.toast.error('Branch Failed', r.error)
          }}
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
          onSelect={(sha) => repo.setSelectedSha(sha)}
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
