import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Sidebar } from './components/Sidebar/Sidebar'
import { TabBar } from './components/TabBar/TabBar'
import { GraphView, WORKTREE_SHA, makeWorktreePseudoCommit } from './components/Graph/GraphView'
import { ConflictPanel } from './components/ConflictPanel/ConflictPanel'
import { ConflictEditor } from './components/ConflictEditor/ConflictEditor'
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
import { MultiSelectDetail } from './components/MultiSelectDetail/MultiSelectDetail'
import { ConsoleDock } from './components/ConsoleDock/ConsoleDock'
import { ReflogPanel } from './components/Reflog/ReflogPanel'
import { CleanModal } from './components/Clean/CleanModal'
import { GitHubPanel } from './components/GitHub/GitHubPanel'
import { Welcome } from './components/Welcome/Welcome'
import { useSettings, SettingsModal } from './components/Settings/Settings'
import { rangeBetween, isContiguous } from './lib/selection'
import {
  ErrorState,
  LoadingState,
  TreeIcon,
  NewBranchModal,
  InputModal,
  ConfirmModal,
  ChoiceModal,
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
  | 'stash-branch'
  | 'branch-from-tag'
  | 'edit-author'
  | 'toolbar-stash'
  | 'settings'
  | 'clean'
  | 'confirm-remove-worktree'
  | 'confirm-drop-commits'
  | CommitActionModal['type']  // 'branch-here' | 'tag-here' | 'confirm-reset-hard' | 'interactive-rebase'
  | null

interface PendingRef {
  name: string
  kind: 'local' | 'remote'
}

export default function App() {
  const repo = useGitRepo()
  const settings = useSettings()  // applies saved text-scale + contrast on mount
  const [modal, setModal]                 = useState<AppModal>(null)
  const [pendingSha, setPendingSha]       = useState<string | null>(null)
  const [pendingRef, setPendingRef]       = useState<PendingRef | null>(null)
  const [pendingStash, setPendingStash]   = useState<number | null>(null)
  const [pendingTag, setPendingTag]       = useState<string | null>(null)
  const [pendingHeadAuthor, setPendingHeadAuthor] = useState<string | null>(null)
  const [pendingWorktree, setPendingWorktree] = useState<{ path: string; name: string; error: string } | null>(null)
  const [selectedRef, setSelectedRef]     = useState<string | null>(null)
  const [showSearch, setShowSearch]       = useState(false)
  const [activeDiff, setActiveDiff]       = useState<{ path: string; staged?: boolean; sha?: string } | null>(null)
  const [activeConflictFile, setActiveConflictFile] = useState<string | null>(null)

  // ── Multi-select commits — shift-click range, ⌘/ctrl-click toggle ──────────
  // `selectedShas` holds every selected commit; `repo.selectedSha` stays the
  // primary (drives CommitDetail / graph scroll). `selectionAnchor` is the
  // pivot for shift-range selection.
  const [selectedShas, setSelectedShas] = useState<string[]>([])
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null)
  const [showReflog, setShowReflog] = useState(false)
  // Bumped only when a sidebar branch/tag/stash pick should scroll the graph to
  // that commit. Graph clicks never bump it, so they don't auto-scroll.
  const [scrollRequest, setScrollRequest] = useState(0)

  // ── Right-panel width — drag the divider to resize, persisted across runs ──
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem('rightPanelWidth'))
    return saved >= 240 && saved <= 900 ? saved : 320
  })
  const graphLayoutRef = useRef<HTMLDivElement>(null)
  const draggingPanel = useRef(false)

  const startPanelDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingPanel.current = true
    // Lock the cursor + kill text selection for the whole drag, not just the handle.
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      if (!draggingPanel.current || !graphLayoutRef.current) return
      const rect = graphLayoutRef.current.getBoundingClientRect()
      const w = rect.right - ev.clientX            // panel hugs the right edge
      const max = Math.max(240, rect.width - 320)  // leave the graph ≥320px
      setRightPanelWidth(Math.min(Math.max(w, 240), Math.min(900, max)))
    }
    const onUp = () => {
      draggingPanel.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  useEffect(() => {
    localStorage.setItem('rightPanelWidth', String(rightPanelWidth))
  }, [rightPanelWidth])

  // ── Left-sidebar width — same drag mechanic; drives --sidebar-width so the
  //    sidebar and the advanced-bar below it resize together ─────────────────
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem('sidebarWidth'))
    return saved >= 180 && saved <= 600 ? saved : 240
  })
  const appBodyRef = useRef<HTMLDivElement>(null)
  const draggingSidebar = useRef(false)

  const startSidebarDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingSidebar.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      if (!draggingSidebar.current || !appBodyRef.current) return
      const rect = appBodyRef.current.getBoundingClientRect()
      const w = ev.clientX - rect.left           // sidebar hugs the left edge
      const max = Math.max(180, rect.width - 400) // leave room for the rest
      setSidebarWidth(Math.min(Math.max(w, 180), Math.min(600, max)))
    }
    const onUp = () => {
      draggingSidebar.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  useEffect(() => {
    localStorage.setItem('sidebarWidth', String(sidebarWidth))
  }, [sidebarWidth])

  // ── Bottom console dock — visibility + 2-axis resize, all persisted ────────
  // Visible by default — only hidden if the user explicitly closed it before.
  const [consoleVisible, setConsoleVisible] = useState(() => localStorage.getItem('console.visible') !== '0')
  const [consoleHeight, setConsoleHeight] = useState(() => {
    const v = Number(localStorage.getItem('console.height'))
    return v >= 120 && v <= 700 ? v : 240
  })
  const [consoleSplitPct, setConsoleSplitPct] = useState(() => {
    const v = Number(localStorage.getItem('console.split'))
    return v >= 20 && v <= 80 ? v : 50
  })
  useEffect(() => { localStorage.setItem('console.visible', consoleVisible ? '1' : '0') }, [consoleVisible])
  useEffect(() => { localStorage.setItem('console.height', String(consoleHeight)) }, [consoleHeight])
  useEffect(() => { localStorage.setItem('console.split', String(consoleSplitPct)) }, [consoleSplitPct])

  // Drag the dock's top edge — moving up makes it taller (it's pinned bottom).
  const startConsoleVDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = consoleHeight
    document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent) => setConsoleHeight(Math.min(700, Math.max(120, startH + (startY - ev.clientY))))
    const onUp = () => {
      document.body.style.cursor = ''; document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }, [consoleHeight])

  // Drag the split between the two consoles (left console width %).
  const startConsoleSplitDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const body = (e.currentTarget as HTMLElement).parentElement
    const rect = body?.getBoundingClientRect()
    if (!rect) return
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent) => setConsoleSplitPct(Math.min(80, Math.max(20, ((ev.clientX - rect.left) / rect.width) * 100)))
    const onUp = () => {
      document.body.style.cursor = ''; document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }, [])

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
    setActiveConflictFile(null)
  }, [repo.repoPath])

  // If the file we're editing in ConflictEditor has been resolved (staged) or
  // the repo left conflict state entirely, close the editor.
  useEffect(() => {
    if (!activeConflictFile) return
    const c = repo.status?.conflict
    if (!c || (!c.inMerge && !c.inRebase)) { setActiveConflictFile(null); return }
    if (!c.conflictedFiles.includes(activeConflictFile)) setActiveConflictFile(null)
  }, [activeConflictFile, repo.status])

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
    setPendingHeadAuthor(null)
  }, [])

  // ── Smart pull ──────────────────────────────────────────────────────
  // Pulls and reacts to common failure modes:
  //   dirty tree     → confirm "stash, pull, pop" and retry with --autostash
  //   diverged hist  → ask the user merge vs rebase and retry with that strategy
  //   untracked      → tell the user which files need to move first
  //   conflict/auth/unknown → show the raw error
  //
  // `silent` skips toasting "Already up to date" — used for chained retries.
  const [pullPrompt, setPullPrompt] = useState<{ kind: 'dirty' | 'diverged'; error: string } | null>(null)
  const doPull = useCallback(async (opts: { rebase?: boolean; autoStash?: boolean } = {}) => {
    const r = await window.gitApi.pull(opts)
    if (r.success) {
      repo.methods.refresh()
      return
    }
    if (r.kind === 'dirty')      { setPullPrompt({ kind: 'dirty', error: r.error }); return }
    if (r.kind === 'diverged')   { setPullPrompt({ kind: 'diverged', error: r.error }); return }
    if (r.kind === 'untracked')  { repo.toast.error('Pull blocked', 'Untracked files would be overwritten. Move or delete them first.'); return }
    if (r.kind === 'conflict')   { repo.toast.warning('Merge conflicts', 'Resolve conflicts in the working tree, then commit.'); repo.methods.refresh(); return }
    if (r.kind === 'auth')       { repo.toast.error('Authentication failed', r.error); return }
    repo.toast.error('Pull failed', r.error)
  }, [repo.methods, repo.toast])

  const handlePull = useCallback(() => doPull({}), [doPull])

  // ── Toolbar stash + pop ────────────────────────────────────────────
  // Quick stash: open input modal to name it, then `git stash push -u -m …`.
  // Quick pop: re-apply the most recent stash with no prompt — symmetric.
  const handleToolbarPop = useCallback(async () => {
    if (repo.stashes.length === 0) return
    const r = await window.gitApi.stashPop(0)
    if (r.success) {
      repo.toast.success('Stash popped', repo.stashes[0]?.message ?? 'stash@{0}')
      repo.methods.refresh()
    } else {
      repo.toast.error('Pop failed', r.error)
    }
  }, [repo.stashes, repo.toast, repo.methods])

  // ── Smart checkout ──────────────────────────────────────────────────
  // Dirty tree triggers an automatic stash before switching — no prompt.
  // The stash is left on the stack (not popped on the destination); the user
  // can re-apply it manually from the sidebar when they're ready.
  const handleCheckout = useCallback(async (branch: string) => {
    const r = await window.gitApi.checkout(branch)
    if (r.success) { repo.methods.refresh(); return }
    if (r.kind === 'dirty') {
      const r2 = await window.gitApi.checkoutAutostash(branch)
      if (r2.success) {
        repo.toast.success('Switched with autostash', r2.stashMessage ?? `Stashed before switching to ${branch}`)
        repo.methods.refresh()
      } else {
        repo.toast.error('Checkout failed', r2.error)
      }
      return
    }
    if (r.kind === 'untracked') {
      repo.toast.error('Checkout blocked', 'Untracked files would be overwritten. Move or delete them first.')
      return
    }
    repo.toast.error('Checkout failed', r.error)
  }, [repo.methods, repo.toast])

  // ── Sidebar handlers ────────────────────────────────────────────────
  const handleCheckoutRemote = useCallback(async (remoteRef: string) => {
    // origin/feature-x → checks out local "feature-x" tracking origin/feature-x
    // git checkout <name> auto-creates the local tracking branch when it
    // doesn't exist locally yet.
    const localName = remoteRef.split('/').slice(1).join('/')
    if (!localName) return
    await handleCheckout(localName)
  }, [handleCheckout])

  // Prepend a synthetic "uncommitted changes" node at the top of the graph
  // when the working tree is dirty. Always row 0 — never mid-list — so the
  // node can't get stranded below newer branch tips after a soft reset moves
  // HEAD downward. Parent edge stays dashed (same treatment as stashes) so it
  // reads as off-history. Skip when status hasn't loaded or HEAD isn't in the
  // current log window (detached / shallow / pre-first-commit).
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
    return [pseudo, ...repo.commits]
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

  // SHAs that bulk ops can act on — real commits only (not the worktree pseudo
  // node or stash nodes).
  const stashShaSet = useMemo(() => new Set(repo.stashes.map(s => s.sha)), [repo.stashes])
  const opSelectedShas = useMemo(
    () => selectedShas.filter(s => s !== WORKTREE_SHA && !stashShaSet.has(s)),
    [selectedShas, stashShaSet],
  )

  // Are the selected commits an unbroken run in the displayed order? (Squash /
  // drop require contiguity; the main process re-validates regardless.)
  const selectionContiguous = useMemo(
    () => isContiguous(displayCommits.map(c => c.sha), opSelectedShas),
    [opSelectedShas, displayCommits],
  )

  // Click handler with modifier support. Plain = single; ⌘/ctrl = toggle;
  // shift = contiguous range from the anchor (by displayed row order).
  const handleSelectCommit = useCallback((sha: string, mods?: { shift?: boolean; meta?: boolean }) => {
    const order = displayCommits.map(c => c.sha)
    if (mods?.shift && selectionAnchor && order.includes(selectionAnchor) && order.includes(sha)) {
      setSelectedShas(rangeBetween(order, selectionAnchor, sha))
      repo.setSelectedSha(sha)
      return
    }
    if (mods?.meta) {
      setSelectedShas(prev => prev.includes(sha) ? prev.filter(s => s !== sha) : [...prev, sha])
      setSelectionAnchor(sha)
      repo.setSelectedSha(sha)
      return
    }
    // Plain click — single selection.
    setSelectedShas([sha])
    setSelectionAnchor(sha)
    repo.setSelectedSha(sha)
  }, [displayCommits, selectionAnchor, repo])

  const clearMultiSelect = useCallback(() => {
    setSelectedShas(repo.selectedSha ? [repo.selectedSha] : [])
    setSelectionAnchor(repo.selectedSha)
  }, [repo.selectedSha])

  // When the primary selection is changed from outside the graph (sidebar ref,
  // reflog, default pseudo-node) to something not in the multi-set, collapse the
  // multi-selection so the right panel reflects the single commit.
  useEffect(() => {
    if (repo.selectedSha && !selectedShas.includes(repo.selectedSha)) {
      setSelectedShas([repo.selectedSha])
      setSelectionAnchor(repo.selectedSha)
    }
  }, [repo.selectedSha, selectedShas])

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
    if (sha) {
      repo.setSelectedSha(sha)
      // Sidebar selection → request a scroll-to-node (the only case we scroll).
      setScrollRequest((n) => n + 1)
    }
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
          { label: `Checkout "${branchName}"`,       icon: '⎇',  disabled: isCurrent, onClick: () => handleCheckout(branchName) },
          { label: `Rename "${branchName}"…`,        icon: '✎',  onClick: () => { setPendingRef({ name: branchName, kind }); setModal('rename-branch') } },
          { label: `Delete "${branchName}"`,         icon: '🗑',  danger: true, disabled: isCurrent, onClick: () => handleDeleteBranch(branchName, false) },
          { separator: true, label: '', onClick: () => {} },
          { label: 'Push to remote',                 icon: '↑',  onClick: () => repo.methods.handlePush() },
          { label: 'Pull from remote',               icon: '↓',  onClick: () => handlePull() },
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
    [openCtx, repo.status, repo.methods, handleDeleteBranch, handleCheckoutRemote, handleCheckout, handlePull],
  )

  const handleStashContextMenu = useCallback(
    (e: React.MouseEvent, index: number) => {
      openCtx(e, [
        { label: 'Apply stash',                icon: '↧',  onClick: () => handleApplyStash(index) },
        { label: 'Pop stash',                  icon: '↥',  onClick: () => handlePopStash(index) },
        { separator: true, label: '', onClick: () => {} },
        { label: 'Create branch from stash…',  icon: '⎇',  onClick: () => { setPendingStash(index); setModal('stash-branch') } },
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
            // Plain remove refuses a dirty/locked worktree — surface an in-app
            // confirm (native window.confirm is unreliable here) to force it.
            else { setPendingWorktree({ path, name, error: r.error }); setModal('confirm-remove-worktree') }
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

  // Auto-update: subscribe once. Informational toasts only — the binary swap
  // happens automatically on next quit (`autoInstallOnAppQuit = true`), so a
  // "restart to install" hint is all the user needs. The silent boot check
  // stays quiet on "no update"; a manual toolbar check reports every outcome.
  const manualUpdateCheck = useRef(false)
  useEffect(() => {
    const unsub = window.gitApi.onUpdaterStatus((s) => {
      if (s.state === 'available') {
        manualUpdateCheck.current = false
        repo.toast.info('Update available', `v${s.version} is downloading…`)
      } else if (s.state === 'downloaded') {
        repo.toast.success('Update ready', `v${s.version} — restart Git Gud to install.`)
      } else if (s.state === 'none') {
        if (manualUpdateCheck.current) {
          manualUpdateCheck.current = false
          repo.toast.success('Up to date', 'You are already on the latest version.')
        }
      } else if (s.state === 'error') {
        if (manualUpdateCheck.current) {
          manualUpdateCheck.current = false
          repo.toast.warning('Update check failed', s.error)
        } else {
          // Expected during dev runs and on unsigned mac builds. Log only.
          console.warn('updater error:', s.error)
        }
      }
    })
    return () => { unsub?.() }
  }, [repo.toast])

  // Toolbar "Check for updates" — feedback comes back through the status
  // subscription above; this only kicks the check off and covers the dev-mode
  // case where the updater IPC isn't registered at all.
  const handleCheckUpdates = useCallback(async () => {
    manualUpdateCheck.current = true
    repo.toast.info('Checking for updates…')
    try {
      const r = await window.gitApi.updaterCheck()
      if (!r.success) {
        manualUpdateCheck.current = false
        repo.toast.warning('Update check failed', r.error)
      }
    } catch {
      manualUpdateCheck.current = false
      repo.toast.info('Updates unavailable', 'Update checks only work in the installed app, not dev mode.')
    }
  }, [repo.toast])

  // All isolated commit actions live in their own hook
  const actions = useCommitActions({
    toast:          repo.toast,
    // Override so SHA checkout (detached HEAD) goes through the autostash
    // prompt path too.
    methods:        { ...repo.methods, handleCheckout },
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
  // ── Bulk (multi-select) commit actions ─────────────────────────────────
  const idxOf = useCallback((sha: string) => displayCommits.findIndex(c => c.sha === sha), [displayCommits])

  const bulkCherryPick = useCallback(async () => {
    if (opSelectedShas.length === 0) return
    const r = await window.gitApi.cherryPickMany(opSelectedShas)
    if (r.success) {
      repo.toast.success('Cherry-picked', `${opSelectedShas.length} commit${opSelectedShas.length === 1 ? '' : 's'} applied to current branch.`)
      clearMultiSelect(); repo.methods.refresh()
    } else repo.toast.error('Cherry-pick Failed', r.error)
  }, [opSelectedShas, repo, clearMultiSelect])

  const bulkRevert = useCallback(async () => {
    if (opSelectedShas.length === 0) return
    const r = await window.gitApi.revertMany(opSelectedShas)
    if (r.success) {
      repo.toast.success('Reverted', `${opSelectedShas.length} commit${opSelectedShas.length === 1 ? '' : 's'} reverted.`)
      clearMultiSelect(); repo.methods.refresh()
    } else repo.toast.error('Revert Failed', r.error)
  }, [opSelectedShas, repo, clearMultiSelect])

  const bulkSquash = useCallback(async () => {
    if (opSelectedShas.length < 2) return
    // Combined message in history order (oldest → newest = highest → lowest idx).
    const oldestFirst = [...opSelectedShas].sort((a, b) => idxOf(b) - idxOf(a))
    const message = oldestFirst.map(s => displayCommits[idxOf(s)]?.message).filter(Boolean).join('\n\n')
    const r = await window.gitApi.squashCommits(opSelectedShas, message)
    if (r.success) {
      repo.toast.success('Squashed', `${opSelectedShas.length} commits combined into one. Use Amend to refine the message.`)
      clearMultiSelect(); repo.methods.refresh()
    } else if (r.conflict) {
      repo.toast.error('Squash hit conflicts', 'Replaying later commits conflicted — resolve in the right panel.')
      repo.methods.refresh()
    } else repo.toast.error('Squash Failed', r.error ?? 'Could not squash the selected commits.')
  }, [opSelectedShas, displayCommits, idxOf, repo, clearMultiSelect])

  // Drop opens an in-app confirm (no native window.confirm); the actual drop
  // runs from the modal's onConfirm via doDropCommits.
  const bulkDrop = useCallback(() => {
    if (opSelectedShas.length === 0) return
    setModal('confirm-drop-commits')
  }, [opSelectedShas])

  const doDropCommits = useCallback(async () => {
    if (opSelectedShas.length === 0) return
    const n = opSelectedShas.length
    const r = await window.gitApi.dropCommits(opSelectedShas)
    if (r.success) {
      repo.toast.success('Dropped', `${n} commit${n === 1 ? '' : 's'} removed from history.`)
      clearMultiSelect(); repo.methods.refresh()
    } else if (r.conflict) {
      repo.toast.error('Drop hit conflicts', 'Replaying later commits conflicted — resolve in the right panel.')
      repo.methods.refresh()
    } else repo.toast.error('Drop Failed', r.error ?? 'Could not drop the selected commits.')
  }, [opSelectedShas, repo, clearMultiSelect])

  const copySelectedShas = useCallback(() => {
    const order = displayCommits
    const list = [...opSelectedShas].sort((a, b) => idxOf(a) - idxOf(b))
      .map(s => order[idxOf(s)]?.shortSha ?? s).join('\n')
    navigator.clipboard.writeText(list).catch(() => {})
  }, [opSelectedShas, displayCommits, idxOf])

  const openBulkCommitMenu = useCallback((e: React.MouseEvent) => {
    const n = opSelectedShas.length
    const rangeNote = selectionContiguous ? undefined : 'Selection must be adjacent (no gaps)'
    openCtx(e, [
      { label: `${n} commits selected`, disabled: true, onClick: () => {} },
      { separator: true, label: '', onClick: () => {} },
      { label: 'Squash into one commit', icon: '⊞', disabled: !selectionContiguous, onClick: bulkSquash },
      { label: 'Cherry-pick onto current branch', icon: '⊕', onClick: bulkCherryPick },
      { label: 'Revert commits', icon: '↶', onClick: bulkRevert },
      { label: rangeNote ?? 'Drop from history', icon: '🗑', danger: true, disabled: !selectionContiguous, onClick: bulkDrop },
      { separator: true, label: '', onClick: () => {} },
      { label: 'Copy SHAs', icon: '⧉', onClick: copySelectedShas },
      { label: 'Clear selection', icon: '✕', onClick: clearMultiSelect },
    ])
  }, [opSelectedShas, selectionContiguous, openCtx, bulkSquash, bulkCherryPick, bulkRevert, bulkDrop, copySelectedShas, clearMultiSelect])

  const handleCommitContextMenu = useCallback((e: React.MouseEvent, sha: string) => {
    // Right-clicking inside an active multi-selection → bulk menu.
    if (opSelectedShas.length > 1 && selectedShas.includes(sha)) {
      openBulkCommitMenu(e)
      return
    }
    // Otherwise collapse to a single selection on the right-clicked commit.
    if (selectedShas.length !== 1 || selectedShas[0] !== sha) {
      setSelectedShas([sha]); setSelectionAnchor(sha); repo.setSelectedSha(sha)
    }
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

    const isHead = !!commit?.refs.includes('HEAD')

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
      {
        label: 'Edit author…',
        icon: '✎',
        disabled: !isHead,
        onClick: async () => {
          const current = await window.gitApi.getHeadAuthor().catch(() => '')
          setPendingSha(sha)
          setPendingHeadAuthor(current)
          setModal('edit-author')
        },
      },

      { separator: true, label: '', onClick: () => {} },

      { label: 'Mark as Bisect Good', icon: '✓', onClick: () => window.gitApi.bisectGood(sha) },
      { label: 'Mark as Bisect Bad',  icon: '✗', danger: true, onClick: () => window.gitApi.bisectBad(sha) },

    ])
  }, [actions, repo, openCtx, opSelectedShas, selectedShas, openBulkCommitMenu])

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
        stashCount={repo.stashes.length}
        onFetch={repo.methods.handleFetch}
        onPull={handlePull}
        onPush={repo.methods.handlePush}
        onStash={() => setModal('toolbar-stash')}
        onPop={handleToolbarPop}
        onRefresh={repo.methods.refresh}
        onNewBranch={() => setModal('new-branch')}
        onSearchToggle={() => setShowSearch(true)}
        onGitHubShow={() => setModal('github')}
        onSettings={() => setModal('settings')}
        onToggleConsole={() => setConsoleVisible((v) => !v)}
        onCheckUpdates={handleCheckUpdates}
      />

      {repo.repoPath && repo.status?.conflict && (repo.status.conflict.inMerge || repo.status.conflict.inRebase) && (
        <div className="conflict-bar">
          <span className="conflict-bar-icon">⚠</span>
          <span className="conflict-bar-label">
            {repo.status.conflict.inRebase ? 'REBASE' : 'MERGE'} IN PROGRESS
          </span>
          <span className="conflict-bar-detail">
            {repo.status.conflict.conflictedFiles.length > 0
              ? `${repo.status.conflict.conflictedFiles.length} unresolved file${repo.status.conflict.conflictedFiles.length === 1 ? '' : 's'} — resolve in the right panel`
              : 'all conflicts resolved — continue in the right panel'}
          </span>
        </div>
      )}

      <div
        className="app-body"
        ref={appBodyRef}
        style={{ ['--sidebar-width' as string]: `${sidebarWidth}px` } as React.CSSProperties}
      >
        {/* Home (no repo) shows only the Welcome screen — the sidebar's
            branches/stashes/etc. belong to a repo tab, not the start page. */}
        {repo.repoPath && (<>
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
          onCheckout={handleCheckout}
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

        <div
          className="panel-resize-handle panel-resize-handle--v"
          onMouseDown={startSidebarDrag}
          title="Drag to resize"
        >
          <div className="panel-resize-grip panel-resize-grip--v" />
        </div>
        </>)}

        <main className="main-content">
          {!repo.repoPath ? (
            <Welcome onOpen={repo.methods.handleOpenRepo} onSelectRecent={repo.methods.loadRepo} />
          ) : repo.loading ? (
            <LoadingState />
          ) : repo.error ? (
            <ErrorState error={repo.error} onRetry={repo.methods.refresh} />
          ) : (
            <div className="graph-layout" ref={graphLayoutRef}>
              <div className="graph-center">
                <div className="graph-center-main">
                  {activeConflictFile ? (
                    <ConflictEditor
                      filePath={activeConflictFile}
                      onClose={() => setActiveConflictFile(null)}
                      onResolved={() => { setActiveConflictFile(null); repo.methods.refresh() }}
                    />
                  ) : activeDiff ? (
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
                      selectedShas={new Set(selectedShas)}
                      scrollRequest={scrollRequest}
                      onSelectCommit={handleSelectCommit}
                      onContextMenu={handleCommitContextMenu}
                      onRefContextMenu={handleRefContextMenu}
                      onRefDrop={handleRefDrop}
                      worktreeBranches={new Set(repo.worktrees.filter(w => !w.isMain).map(w => w.branch))}
                      stashes={repo.stashes}
                    />
                  )}
                </div>

                {consoleVisible && (
                  <ConsoleDock
                    repoPath={repo.repoPath}
                    height={consoleHeight}
                    splitPct={consoleSplitPct}
                    onVDragStart={startConsoleVDrag}
                    onSplitDragStart={startConsoleSplitDrag}
                    onClose={() => setConsoleVisible(false)}
                    onCommandDone={repo.methods.refresh}
                  />
                )}
              </div>

              <div
                className="panel-resize-handle panel-resize-handle--v"
                onMouseDown={startPanelDrag}
                title="Drag to resize"
              >
                <div className="panel-resize-grip panel-resize-grip--v" />
              </div>
              <div className="right-panel" style={{ width: rightPanelWidth }}>
                <div className="right-panel-body">
                  {repo.status?.conflict && (repo.status.conflict.inMerge || repo.status.conflict.inRebase) ? (
                    <ConflictPanel
                      state={repo.status.conflict}
                      currentBranch={repo.status?.branch ?? ''}
                      onSelectDiff={(path) => { setActiveDiff(null); setActiveConflictFile(path) }}
                      onRefresh={repo.methods.refresh}
                    />
                  ) : showReflog ? (
                    <ReflogPanel
                      repoPath={repo.repoPath}
                      onClose={() => setShowReflog(false)}
                      onRestored={() => { setShowReflog(false); repo.methods.refresh() }}
                    />
                  ) : modal === 'bisect' ? (
                    <BisectWizard
                      commits={repo.commits}
                      onClose={() => { closeModal(); repo.methods.refresh() }}
                    />
                  ) : modal === 'patch' ? (
                    <PatchPanel
                      status={repo.status}
                      onClose={closeModal}
                    />
                  ) : showWorkingTree ? (
                    <WorkingTree
                      repoPath={repo.repoPath}
                      status={repo.status}
                      onRefresh={repo.methods.refresh}
                      // Close the center-pane diff after committing — the
                      // graph + new commit row is the more useful view.
                      onCommitted={() => { setActiveDiff(null); repo.methods.refresh() }}
                      onSelectDiff={(path, staged) => setActiveDiff({ path, staged })}
                      // Commit/hook output now streams to the bottom console
                      // (git-activity log) instead of taking over the center —
                      // open the dock so the user sees it.
                      onCommitRun={() => setConsoleVisible(true)}
                    />
                  ) : opSelectedShas.length > 1 ? (
                    <MultiSelectDetail
                      shas={opSelectedShas}
                      commits={displayCommits}
                      contiguous={selectionContiguous}
                      onSquash={bulkSquash}
                      onCherryPick={bulkCherryPick}
                      onRevert={bulkRevert}
                      onDrop={bulkDrop}
                      onCopyShas={copySelectedShas}
                      onClear={clearMultiSelect}
                      onSelectOne={(sha) => { setSelectedShas([sha]); setSelectionAnchor(sha); repo.setSelectedSha(sha) }}
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
            <button
              className={`adv-btn ${showReflog ? 'active' : ''}`}
              title="Reflog — recover lost commits"
              onClick={() => setShowReflog((v) => !v)}
            >⎌ Reflog</button>
            <button className="adv-btn" title="Clean untracked/ignored files" onClick={() => setModal('clean')}>🧹 Clean</button>
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
      {modal === 'settings' && (
        <SettingsModal {...settings} onClose={closeModal} />
      )}
      {modal === 'clean' && (
        <CleanModal
          onClose={closeModal}
          onCleaned={() => { closeModal(); repo.methods.refresh() }}
        />
      )}
      {modal === 'confirm-drop-commits' && opSelectedShas.length > 0 && (
        <ConfirmModal
          title="Drop commits from history?"
          message={`Remove ${opSelectedShas.length} commit${opSelectedShas.length === 1 ? '' : 's'} from history.`}
          detail="This rewrites history and cannot be undone."
          confirmLabel="Drop"
          danger
          onClose={closeModal}
          onConfirm={doDropCommits}
        />
      )}
      {modal === 'confirm-remove-worktree' && pendingWorktree && (
        <ConfirmModal
          title="Force remove worktree?"
          message={`"${pendingWorktree.name}" has uncommitted or untracked changes, so it can't be removed normally.`}
          detail={`${pendingWorktree.error}\n\nForce-removing discards those changes. This cannot be undone.`}
          confirmLabel="Force remove"
          danger
          onClose={() => { closeModal(); setPendingWorktree(null) }}
          onConfirm={async () => {
            const wt = pendingWorktree   // captured before state clears
            setPendingWorktree(null)
            const r = await window.gitApi.removeWorktree(wt.path, true)
            if (r.success) { repo.toast.success('Worktree Removed', wt.name); repo.methods.refresh() }
            else repo.toast.error('Remove Failed', r.error)
          }}
        />
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
      {modal === 'stash-branch' && pendingStash !== null && (
        <InputModal
          title={`Create Branch from stash@{${pendingStash}}`}
          subtitle="Applies the stash and removes it from the list."
          placeholder="Branch name"
          confirmLabel="Create Branch"
          onClose={closeModal}
          onConfirm={async (name) => {
            const idx = pendingStash
            closeModal()
            const r = await window.gitApi.stashBranch(name, idx)
            if (r.success) {
              repo.toast.success('Branch Created', `${name} from stash@{${idx}}`)
              repo.methods.refresh()
            } else {
              repo.toast.error('Stash Branch Failed', r.error)
            }
          }}
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
      {modal === 'toolbar-stash' && (
        <InputModal
          title="Stash changes"
          subtitle="Stashes working tree + index + untracked files. Default name suggested."
          placeholder="Stash message"
          initialValue={`WIP on ${repo.status?.branch ?? 'branch'}`}
          confirmLabel="Stash"
          onClose={closeModal}
          onConfirm={async (msg) => {
            closeModal()
            const r = await window.gitApi.stashSave(msg.trim() || undefined)
            if (r.success) {
              repo.toast.success('Stashed', msg)
              repo.methods.refresh()
            } else {
              repo.toast.error('Stash failed', r.error)
            }
          }}
        />
      )}
      {modal === 'edit-author' && pendingHeadAuthor !== null && (
        <InputModal
          title="Edit author of HEAD commit"
          subtitle="Format: Name <email>. Amends HEAD without changing its message; older commits aren't supported here."
          placeholder="Name <email@example.com>"
          initialValue={pendingHeadAuthor}
          confirmLabel="Update Author"
          onClose={closeModal}
          onConfirm={async (value) => {
            closeModal()
            const r = await window.gitApi.setHeadAuthor(value)
            if (r.success) { repo.toast.success('Author updated', value); repo.methods.refresh() }
            else repo.toast.error('Author update failed', r.error)
          }}
        />
      )}

      {pullPrompt?.kind === 'dirty' && (
        <ConfirmModal
          title="Pull blocked by local changes"
          message="Your working tree has uncommitted changes that would be overwritten by the incoming commits."
          detail="Stash your changes, pull, then re-apply the stash automatically? Conflicts during re-apply will leave the stash on the stack so nothing is lost."
          confirmLabel="Stash, Pull, and Re-apply"
          onClose={() => setPullPrompt(null)}
          onConfirm={() => { setPullPrompt(null); doPull({ autoStash: true }) }}
        />
      )}
      {pullPrompt?.kind === 'diverged' && (
        <ChoiceModal
          title="Local and remote have diverged"
          message="Your branch and the remote both have commits the other doesn't. Pick a strategy to combine them."
          detail="Merge keeps history as-is and adds a merge commit. Rebase replays your local commits on top of the remote tip (cleaner history, rewrites your local SHAs)."
          actions={[
            { label: 'Merge',  primary: true, onClick: () => doPull({ rebase: false }) },
            { label: 'Rebase',                onClick: () => doPull({ rebase: true }) },
          ]}
          onClose={() => setPullPrompt(null)}
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
