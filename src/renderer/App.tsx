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
import { Icon } from './components/Icons/Icon'
import { DiffViewer } from './components/DiffViewer/DiffViewer'
import { MultiSelectDetail } from './components/MultiSelectDetail/MultiSelectDetail'
import { ConsoleDock } from './components/ConsoleDock/ConsoleDock'
import { ReflogPanel } from './components/Reflog/ReflogPanel'
import { CleanModal } from './components/Clean/CleanModal'
import { GitHubPanel } from './components/GitHub/GitHubPanel'
import { CloneModal } from './components/Clone/CloneModal'
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
import { useGerrit } from './hooks/useGerrit'
import { GerritBanner, GerritEnableModal, PushForReviewModal } from './components/Gerrit/GerritPanel'
import { GERRIT_OUTDATED_REF_PREFIX } from './lib/refs'
import './styles/App.css'

// All modal types that App.tsx manages.
// Actions that need user interaction set one of these before displaying.
type AppModal =
  | 'worktrees'
  | 'bisect'
  | 'patch'
  | 'github'
  | 'clone'
  | 'new-branch'
  | 'rename-branch'
  | 'confirm-delete-branch'
  | 'confirm-delete-remote-branch'
  | 'confirm-drop-stash'
  | 'stash-branch'
  | 'branch-from-tag'
  | 'rename-tag'
  | 'edit-author'
  | 'toolbar-stash'
  | 'settings'
  | 'clean'
  | 'gerrit-enable'
  | 'push-for-review'
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
  // Gerrit mode — everything renders behind gerrit.enabled; non-Gerrit repos
  // see zero UI difference (see openspec/changes/add-gerrit-mode).
  const gerrit = useGerrit(repo.repoPath, repo.commits, repo.methods.refresh)
  // Focus + scroll the graph to a commit (Gerrit jump-to-current etc.).
  const focusCommit = useCallback((sha: string) => {
    setSelectedShas([sha])
    setSelectionAnchor(sha)
    repo.setSelectedSha(sha)
    setScrollRequest((n) => n + 1)
  }, [repo])
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

  // The "+" tab / "Open Repository" entry points offer a choice: pick a local
  // folder, or clone from a remote (any URL or a signed-in service).
  const openRepoSourceMenu = useCallback((e: React.MouseEvent) => {
    openCtx(e, [
      { label: 'Open Local Repository…', icon: 'folder', onClick: () => repo.methods.handleOpenRepo() },
      { label: 'Clone Remote Repository…', icon: 'download', onClick: () => setModal('clone') },
    ])
  }, [openCtx, repo.methods])

  // ── Smart pull ──────────────────────────────────────────────────────
  // Pulls and reacts to common failure modes:
  //   dirty tree     → confirm "stash, pull, pop" and retry with --autostash
  //   diverged hist  → ask the user merge vs rebase and retry with that strategy
  //   untracked      → tell the user which files need to move first
  //   conflict/auth/unknown → show the raw error
  //
  // `silent` skips toasting "Already up to date" — used for chained retries.
  const [pullPrompt, setPullPrompt] = useState<{ kind: 'dirty' | 'diverged'; error: string } | null>(null)
  const doPull = useCallback(async (opts: { rebase?: boolean; autoStash?: boolean; ffOnly?: boolean } = {}) => {
    const r = await window.gitApi.pull(opts)
    if (r.success) {
      repo.methods.refresh()
      return
    }
    // ff-only refusals get a targeted explanation, never the merge/rebase
    // recovery prompt — the user explicitly asked for fast-forward only.
    if (r.kind === 'not-ff')     { repo.toast.warning('Fast-forward not possible', 'Local and remote have diverged — pull with merge or rebase instead.'); return }
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
  // Old patchsets of open Gerrit changes present in the log (usually because
  // another open change still builds on them): sha → change number. Current
  // patchsets are excluded — they carry a real refs/gitgud/changes/<n> ref.
  const gerritOutdatedBySha = useMemo(() => {
    const m = new Map<string, number>()
    if (!gerrit.enabled) return m
    const currentShas = new Set(gerrit.changes.map((c) => c.currentSha).filter(Boolean))
    for (const ch of gerrit.changes) {
      for (const ps of ch.patchsets) {
        if (ps.sha !== ch.currentSha && !currentShas.has(ps.sha)) m.set(ps.sha, ch.number)
      }
    }
    return m
  }, [gerrit.enabled, gerrit.changes])

  const displayCommits = useMemo(() => {
    // Tag outdated-patchset commits with a synthetic marker ref so they get a
    // dimmed "#<n>" pill instead of reading as anonymous orphan nodes.
    let commits = repo.commits
    if (gerritOutdatedBySha.size > 0) {
      let touched = false
      const annotated = commits.map((c) => {
        const n = gerritOutdatedBySha.get(c.sha)
        if (n === undefined) return c
        touched = true
        return { ...c, refs: [...c.refs, `${GERRIT_OUTDATED_REF_PREFIX}${n}`] }
      })
      if (touched) commits = annotated
    }
    if (!repo.status) return commits
    const dirty =
      repo.status.staged.length +
      repo.status.unstaged.length +
      repo.status.untracked.length
    if (dirty === 0) return commits
    const headIdx = commits.findIndex(c => c.refs.includes('HEAD'))
    if (headIdx < 0) return commits
    const pseudo = makeWorktreePseudoCommit(commits[headIdx].sha, dirty)
    return [pseudo, ...commits]
  }, [repo.commits, repo.status, gerritOutdatedBySha])

  // The selected commit's relationship to an open Gerrit change (current or
  // outdated patchset) — drives the amendment block in CommitDetail.
  const gerritSelectedInfo = useMemo(() => {
    if (!gerrit.enabled || !repo.selectedSha) return null
    for (const change of gerrit.changes) {
      const ps = change.patchsets.find((p) => p.sha === repo.selectedSha)
      if (ps) return { change, patchsetNumber: ps.number, isCurrent: ps.sha === change.currentSha }
      if (change.currentSha === repo.selectedSha) {
        return { change, patchsetNumber: change.patchset, isCurrent: true }
      }
    }
    return null
  }, [gerrit.enabled, gerrit.changes, repo.selectedSha])

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
    const t = repo.toast.progress('Deleting remote branch…', remoteRef)
    const r = await window.gitApi.deleteRemoteBranch(remote, branch)
    if (r.success) {
      repo.toast.resolve(t, 'success', 'Remote Branch Deleted', `${remoteRef} removed.`)
      repo.methods.refresh()
    } else {
      repo.toast.resolve(t, 'error', 'Delete Remote Branch Failed', r.error)
    }
  }, [repo.toast, repo.methods])

  const handleCreateBranchFromTag = useCallback((tagName: string) => {
    setPendingTag(tagName)
    setModal('branch-from-tag')
  }, [])

  // Context-menu copies get a toast — the menu closes on click, so unlike a
  // persistent CopyButton there is no in-place element left to flip to ✓.
  const copyToClipboard = useCallback((text: string, what: string) => {
    navigator.clipboard.writeText(text)
      .then(() => repo.toast.success('Copied', what))
      .catch(() => repo.toast.error('Copy failed', what))
  }, [repo.toast])

  // ── Sidebar context-menu factories ─────────────────────────────────
  const handleBranchContextMenu = useCallback(
    (e: React.MouseEvent, branchName: string, kind: 'local' | 'remote') => {
      if (kind === 'local') {
        const isCurrent = repo.status?.branch === branchName
        openCtx(e, [
          { label: `Checkout "${branchName}"`,       icon: 'branch',  disabled: isCurrent, onClick: () => handleCheckout(branchName) },
          { label: `Rename "${branchName}"…`,        icon: 'edit',  onClick: () => { setPendingRef({ name: branchName, kind }); setModal('rename-branch') } },
          { label: `Delete "${branchName}"`,         icon: 'trash',  danger: true, disabled: isCurrent, onClick: () => handleDeleteBranch(branchName, false) },
          { separator: true, label: '', onClick: () => {} },
          { label: 'Push to remote',                 icon: 'arrow-up',  onClick: () => repo.methods.handlePush() },
          { label: 'Force push (--force-with-lease)', icon: 'warning', danger: true, disabled: !isCurrent, onClick: () => repo.methods.handlePush(true) },
          { label: 'Pull from remote',               icon: 'arrow-down',  onClick: () => handlePull() },
          { separator: true, label: '', onClick: () => {} },
          { label: 'Copy branch name',               icon: 'copy',  onClick: () => copyToClipboard(branchName, branchName) },
        ])
      } else {
        const shortName = branchName.split('/').slice(1).join('/')
        openCtx(e, [
          { label: `Checkout "${shortName}" (track)`, icon: 'branch',  onClick: () => handleCheckoutRemote(branchName) },
          { label: `Delete remote "${branchName}"`,   icon: 'trash',  danger: true, onClick: () => { setPendingRef({ name: branchName, kind }); setModal('confirm-delete-remote-branch') } },
          { separator: true, label: '', onClick: () => {} },
          { label: 'Copy ref name',                   icon: 'copy',  onClick: () => copyToClipboard(branchName, branchName) },
        ])
      }
    },
    [openCtx, repo.status, repo.methods, handleDeleteBranch, handleCheckoutRemote, handleCheckout, handlePull],
  )

  const handleStashContextMenu = useCallback(
    (e: React.MouseEvent, index: number) => {
      openCtx(e, [
        { label: 'Apply stash',                icon: 'stash-apply',  onClick: () => handleApplyStash(index) },
        { label: 'Pop stash',                  icon: 'stash-pop',  onClick: () => handlePopStash(index) },
        { separator: true, label: '', onClick: () => {} },
        { label: 'Create branch from stash…',  icon: 'branch',  onClick: () => { setPendingStash(index); setModal('stash-branch') } },
        { separator: true, label: '', onClick: () => {} },
        { label: 'Drop stash',                 icon: 'trash',  danger: true, onClick: () => { setPendingStash(index); setModal('confirm-drop-stash') } },
      ])
    },
    [openCtx, handleApplyStash, handlePopStash],
  )

  const handleTagContextMenu = useCallback(
    (e: React.MouseEvent, tagName: string) => {
      const remote = repo.remotes[0]?.name ?? 'origin'
      const hasRemote = repo.remotes.length > 0
      const run = (doing: string, label: string, op: Promise<{ success: boolean; error?: string }>) => {
        const t = repo.toast.progress(doing, `"${tagName}"`)
        return op.then((r) => {
          if (r.success) { repo.toast.resolve(t, 'success', label, `"${tagName}"`); repo.methods.refresh() }
          else repo.toast.resolve(t, 'error', `${label} failed`, r.error)
        })
      }
      openCtx(e, [
        { label: `Create branch from "${tagName}"…`, icon: 'branch', onClick: () => handleCreateBranchFromTag(tagName) },
        { label: `Rename "${tagName}"…`, icon: 'edit', onClick: () => { setPendingTag(tagName); setModal('rename-tag') } },
        {
          label: `Push tag to ${remote}`, icon: 'arrow-up', disabled: !hasRemote,
          onClick: () => run('Pushing tag…', 'Tag pushed', window.gitApi.pushTag(remote, tagName)),
        },
        { separator: true, label: '', onClick: () => {} },
        { label: 'Copy tag name', icon: 'copy', onClick: () => copyToClipboard(tagName, tagName) },
        { separator: true, label: '', onClick: () => {} },
        {
          label: 'Delete local tag', icon: 'trash', danger: true,
          onClick: () => run('Deleting tag…', 'Tag deleted', window.gitApi.deleteTag(tagName)),
        },
        {
          label: `Delete tag from ${remote}`, icon: 'trash', danger: true, disabled: !hasRemote,
          onClick: () => run('Deleting remote tag…', 'Remote tag deleted', window.gitApi.deleteRemoteTag(remote, tagName)),
        },
      ])
    },
    [openCtx, handleCreateBranchFromTag, repo.remotes, repo.toast, repo.methods],
  )

  const handleWorktreeContextMenu = useCallback(
    (e: React.MouseEvent, path: string, isMain: boolean) => {
      const name = path.split('/').pop() || path
      const isCurrent = path === repo.repoPath
      openCtx(e, [
        { label: `Switch to "${name}"`, icon: 'branch', disabled: isCurrent, onClick: () => repo.methods.loadRepo(path) },
        { separator: true, label: '', onClick: () => {} },
        { label: 'Manage worktrees…', icon: 'worktree', onClick: () => setModal('worktrees') },
        { separator: true, label: '', onClick: () => {} },
        {
          label: `Remove worktree`,
          icon: 'trash',
          danger: true,
          disabled: isMain || isCurrent,
          onClick: async () => {
            // The menu is gone the moment this runs — the progress toast is
            // the only signal the click landed.
            const t = repo.toast.progress('Removing worktree…', name)
            const r = await window.gitApi.removeWorktree(path)
            if (r.success) { repo.toast.resolve(t, 'success', 'Worktree Removed', name); repo.methods.refresh() }
            // Plain remove refuses a dirty/locked worktree — surface an in-app
            // confirm (native window.confirm is unreliable here) to force it.
            else { repo.toast.remove(t); setPendingWorktree({ path, name, error: r.error }); setModal('confirm-remove-worktree') }
          },
        },
        { separator: true, label: '', onClick: () => {} },
        { label: 'Copy path', icon: 'copy', onClick: () => copyToClipboard(path, path) },
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
        { label: `Merge "${sourceShort}" → "${targetShort}"`, icon: 'merge', onClick: () => runDragAction(source, target, 'merge') },
        { label: `Rebase "${sourceShort}" onto "${targetShort}"`, icon: 'rebase', onClick: () => runDragAction(source, target, 'rebase') },
        { separator: true, label: '', onClick: () => {} },
        { label: `Checkout "${targetShort}"`, icon: 'branch', onClick: () => runDragAction(source, target, 'checkout') },
      ])
    },
    [openCtx, runDragAction],
  )

  // Auto-update: subscribe once. The binary swap happens automatically on next
  // quit (`autoInstallOnAppQuit = true`); the "downloaded" toast also offers a
  // "Restart now" button that quits + installs immediately. The silent boot
  // check stays quiet on "no update"; a manual toolbar check reports every
  // outcome.
  const manualUpdateCheck = useRef(false)
  // Mirrors the updater lifecycle into the sidebar version chip so download
  // progress and the ready-to-restart state stay visible after toasts fade.
  const [appVersion, setAppVersion] = useState('')
  const [updateInfo, setUpdateInfo] = useState<{ state: 'idle' | 'downloading' | 'ready'; version?: string; percent?: number }>({ state: 'idle' })
  useEffect(() => {
    window.gitApi.getAppVersion?.().then(setAppVersion).catch(() => {})
  }, [])
  useEffect(() => {
    const unsub = window.gitApi.onUpdaterStatus((s) => {
      if (s.state === 'available') {
        manualUpdateCheck.current = false
        setUpdateInfo({ state: 'downloading', version: s.version, percent: 0 })
        repo.toast.info('Update available', `v${s.version} is downloading…`)
      } else if (s.state === 'downloaded') {
        setUpdateInfo({ state: 'ready', version: s.version })
        repo.toast.success('Update ready', `v${s.version} — restart Git Gud to install.`, {
          label: 'Restart now',
          onClick: () => { window.gitApi.updaterInstall() },
        })
      } else if (s.state === 'none') {
        setUpdateInfo({ state: 'idle' })
        if (manualUpdateCheck.current) {
          manualUpdateCheck.current = false
          repo.toast.success('Up to date', 'You are already on the latest version.')
        }
      } else if (s.state === 'error') {
        setUpdateInfo({ state: 'idle' })
        if (manualUpdateCheck.current) {
          manualUpdateCheck.current = false
          repo.toast.warning('Update check failed', s.error)
        } else {
          // Expected during dev runs. Log only.
          console.warn('updater error:', s.error)
        }
      }
    })
    const unsubProgress = window.gitApi.onUpdaterProgress((p) => {
      setUpdateInfo((u) => u.state === 'downloading' ? { ...u, percent: p.percent } : u)
    })
    return () => { unsub?.(); unsubProgress?.() }
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

  // Returns success so callers can show feedback fitting their surface:
  // the detail panel flips its button to ✓, the context menu toasts.
  const copySelectedShas = useCallback(async (): Promise<boolean> => {
    const order = displayCommits
    const list = [...opSelectedShas].sort((a, b) => idxOf(a) - idxOf(b))
      .map(s => order[idxOf(s)]?.shortSha ?? s).join('\n')
    return navigator.clipboard.writeText(list).then(() => true).catch(() => false)
  }, [opSelectedShas, displayCommits, idxOf])

  const openBulkCommitMenu = useCallback((e: React.MouseEvent) => {
    const n = opSelectedShas.length
    const rangeNote = selectionContiguous ? undefined : 'Selection must be adjacent (no gaps)'
    openCtx(e, [
      { label: `${n} commits selected`, disabled: true, onClick: () => {} },
      { separator: true, label: '', onClick: () => {} },
      { label: 'Squash into one commit', icon: 'squash', disabled: !selectionContiguous, onClick: bulkSquash },
      { label: 'Cherry-pick onto current branch', icon: 'cherry-pick', onClick: bulkCherryPick },
      { label: 'Revert commits', icon: 'revert', onClick: bulkRevert },
      { label: rangeNote ?? 'Drop from history', icon: 'trash', danger: true, disabled: !selectionContiguous, onClick: bulkDrop },
      { separator: true, label: '', onClick: () => {} },
      { label: 'Copy SHAs', icon: 'copy', onClick: () => {
        copySelectedShas().then((ok) => ok
          ? repo.toast.success('Copied', `${n} SHA${n === 1 ? '' : 's'}`)
          : repo.toast.error('Copy failed'))
      } },
      { label: 'Clear selection', icon: 'x', onClick: clearMultiSelect },
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
    const currentBranch = repo.status?.branch ?? ''
    const detached = !currentBranch || currentBranch === 'HEAD'
    const inBisect = !!repo.status?.inBisect

    // Bisect marks check out the next candidate commit — refresh so the graph
    // follows, and surface git's "N revisions left" line.
    const bisectMark = async (good: boolean) => {
      try {
        const out = good ? await window.gitApi.bisectGood(sha) : await window.gitApi.bisectBad(sha)
        repo.toast.info(good ? 'Marked as good' : 'Marked as bad', out?.split('\n')[0] ?? '')
      } catch (err) {
        repo.toast.error('Bisect failed', String(err))
      }
      repo.methods.refresh()
    }

    openCtx(e, [
      { label: 'Checkout (detached HEAD)',       icon: 'commit',  onClick: () => actions.checkoutSha(sha) },
      { label: 'Create branch here…',            icon: 'branch',  onClick: () => actions.requestBranchHere(sha) },

      { separator: true, label: '', onClick: () => {} },

      { label: 'Cherry-pick',                    icon: 'cherry-pick',  onClick: () => actions.cherryPick(sha) },
      { label: 'Revert commit',                  icon: 'revert',  onClick: () => actions.revert(sha) },
      { label: 'Rebase onto this commit',        icon: 'rebase',  onClick: () => actions.rebaseTo(sha) },
      { label: 'Interactive rebase from here…',  icon: 'rebase',  onClick: () => actions.interactiveRebaseFrom(sha) },

      // ── Both merge directions — each hidden/disabled when it would be a
      //    self-merge (commit is HEAD / target is the current branch) ────────
      {
        label: 'Merge this into current branch',
        icon: 'merge',
        disabled: isHead,
        onClick: () => actions.mergeThisIntoCurrent(sha),
      },
      {
        label: localBranch
          ? `Merge current branch into "${localBranch}"`
          : 'Merge current branch into this (no local branch)',
        icon: 'merge',
        disabled: !localBranch || detached || localBranch === currentBranch,
        onClick: () => localBranch && actions.mergeCurrentIntoThis(localBranch),
      },

      { separator: true, label: '', onClick: () => {} },

      { label: 'Reset → Soft',   icon: 'reset', onClick: () => actions.resetSoft(sha) },
      { label: 'Reset → Mixed',  icon: 'reset', onClick: () => actions.resetMixed(sha) },
      { label: 'Reset → Hard',   icon: 'reset', danger: true, onClick: () => actions.requestResetHard(sha) },

      { separator: true, label: '', onClick: () => {} },

      { label: 'Create tag here…', icon: 'tag', onClick: () => actions.requestTagHere(sha) },
      { label: 'Export patch…',    icon: 'file-diff', onClick: () => { repo.setSelectedSha(sha); setModal('patch') } },
      {
        label: 'Edit author…',
        icon: 'edit',
        disabled: !isHead,
        onClick: async () => {
          const current = await window.gitApi.getHeadAuthor().catch(() => '')
          setPendingSha(sha)
          setPendingHeadAuthor(current)
          setModal('edit-author')
        },
      },

      // Bisect marks only exist while a bisect session is running — outside
      // one, `git bisect good/bad` errors and the entries are just noise.
      ...(inBisect ? [
        { separator: true, label: '', onClick: () => {} },
        { label: 'Mark as Bisect Good', icon: 'check-circle', onClick: () => bisectMark(true) },
        { label: 'Mark as Bisect Bad',  icon: 'x-circle', danger: true, onClick: () => bisectMark(false) },
      ] : []),
    ])
  }, [actions, repo, openCtx, opSelectedShas, selectedShas, openBulkCommitMenu])

  const rebaseCommits = repo.selectedSha
    ? repo.commits.slice(0, repo.commits.findIndex(c => c.sha === repo.selectedSha) + 1).slice(0, 20)
    : repo.commits.slice(0, 20)

  return (
    <div className="app">
      <div className="titlebar" />

      <TabBar
        tabs={repo.openTabs.map((t) => t.main)}
        activePath={repo.mainPath}
        onActivate={repo.methods.switchTab}
        onClose={repo.methods.closeTab}
        onReorder={repo.methods.reorderTabs}
        onOpenMenu={openRepoSourceMenu}
        onGoHome={repo.methods.handleGoHome}
        appVersion={appVersion}
        update={updateInfo}
        onUpdateAction={() => { updateInfo.state === 'ready' ? window.gitApi.updaterInstall() : handleCheckUpdates() }}
      />

      <Toolbar
        repoPath={repo.repoPath}
        worktreeName={repo.repoPath && repo.mainPath && repo.repoPath !== repo.mainPath
          ? (repo.repoPath.split('/').pop() ?? repo.repoPath)
          : null}
        onWorktreeChip={() => setModal('worktrees')}
        currentBranch={repo.status?.branch ?? ''}
        ahead={repo.status?.ahead ?? 0}
        behind={repo.status?.behind ?? 0}
        stashCount={repo.stashes.length}
        onFetch={repo.methods.handleFetch}
        onPull={handlePull}
        onPullMenu={(e) => {
          e.preventDefault()
          openCtx(e, [
            { label: 'Pull', icon: 'arrow-down', onClick: () => doPull({}) },
            { label: 'Pull (fast-forward only)', icon: 'arrow-down', onClick: () => doPull({ ffOnly: true }) },
            { label: 'Pull (rebase)', icon: 'rebase', onClick: () => doPull({ rebase: true }) },
          ])
        }}
        onPush={repo.methods.handlePush}
        gerritMode={gerrit.enabled}
        onPushForReview={() => setModal('push-for-review')}
        onPushMenu={(e) => {
          e.preventDefault()
          openCtx(e, [
            // "Push for review…" only exists in Gerrit mode; the plain and
            // force entries are the pre-Gerrit menu, unchanged.
            ...(gerrit.enabled
              ? [{ label: 'Push for review…', icon: 'arrow-up' as const, onClick: () => setModal('push-for-review') }]
              : []),
            { label: 'Push', icon: 'arrow-up', onClick: () => repo.methods.handlePush() },
            {
              label: 'Force push (--force-with-lease)', icon: 'warning', danger: true,
              onClick: () => repo.methods.handlePush(true),
            },
          ])
        }}
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

      {/* Gerrit suggestion — one-time, persists both answers to repo config */}
      {repo.repoPath && gerrit.suggested && (
        <GerritBanner
          onEnable={() => setModal('gerrit-enable')}
          onDismiss={gerrit.actions.dismiss}
        />
      )}

      {repo.repoPath && repo.status?.conflict && (repo.status.conflict.inMerge || repo.status.conflict.inRebase) && (
        <div className="conflict-bar">
          <span className="conflict-bar-icon"><Icon name="warning" size={14} /></span>
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
        {/* Sidebar column: scrollable nav on top, advanced bar as a fixed
            footer BELOW it (in-flow) — never overlapping the last section. */}
        <div className="sidebar-col">
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
          onRevealRepo={() => { if (repo.repoPath) window.uiApi.showInFolder(repo.repoPath) }}
          onGoHome={repo.methods.handleGoHome}
          onBranchContextMenu={handleBranchContextMenu}
          onStashContextMenu={handleStashContextMenu}
          onTagContextMenu={handleTagContextMenu}
          onWorktreeClick={repo.methods.switchWorktree}
          onWorktreeContextMenu={handleWorktreeContextMenu}
          onWorktreeManage={() => setModal('worktrees')}
          onRefDrop={handleRefDrop}
        />

        <div className="advanced-bar">
          <button className="adv-btn" title="Bisect" onClick={() => setModal('bisect')}><Icon name="bisect" size={13} /> Bisect</button>
          <button className="adv-btn" title="Patch" onClick={() => setModal('patch')}><Icon name="file-diff" size={13} /> Patch</button>
          <button
            className={`adv-btn ${showReflog ? 'active' : ''}`}
            title="Reflog — recover lost commits"
            onClick={() => setShowReflog((v) => !v)}
          ><Icon name="history" size={13} /> Reflog</button>
          <button className="adv-btn" title="Clean untracked/ignored files" onClick={() => setModal('clean')}><Icon name="clean" size={13} /> Clean</button>
        </div>
        </div>

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
            <Welcome onOpen={repo.methods.handleOpenRepo} onClone={() => setModal('clone')} onSelectRecent={repo.methods.loadRepo} />
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
                      gerritMode={gerrit.enabled}
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
                      commits={displayCommits}
                      gerritHost={gerrit.enabled ? gerrit.mode?.host || null : null}
                      gerritInfo={gerritSelectedInfo}
                      onJumpToSha={focusCommit}
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

      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {modal === 'interactive-rebase' && (
        <InteractiveRebase
          commits={rebaseCommits.map(c => ({ sha: c.sha, shortSha: c.shortSha, message: c.message }))}
          onClose={() => { closeModal(); repo.methods.refresh() }}
        />
      )}
      {modal === 'worktrees' && (
        <Worktrees currentPath={repo.repoPath} onClose={closeModal} onSwitch={(p) => { closeModal(); repo.methods.switchWorktree(p) }} />
      )}
      {modal === 'settings' && (
        <SettingsModal
          {...settings}
          onClose={closeModal}
          gerrit={repo.repoPath && gerrit.mode ? {
            mode: gerrit.mode,
            authenticated: gerrit.authenticated,
            onToggle: (enabled) => { if (enabled) gerrit.actions.enable(); else gerrit.actions.disable() },
            onUpdate: gerrit.actions.updateSettings,
            onSetAuth: gerrit.actions.setAuth,
            onClearAuth: gerrit.actions.clearAuth,
          } : null}
        />
      )}
      {modal === 'gerrit-enable' && gerrit.mode && (
        <GerritEnableModal
          initial={{ host: gerrit.mode.host, project: gerrit.mode.project, branch: gerrit.mode.branch }}
          onClose={closeModal}
          onEnable={(values) => { gerrit.actions.enable(values); closeModal() }}
        />
      )}
      {modal === 'push-for-review' && gerrit.mode && (
        <PushForReviewModal
          remote={gerrit.detection?.remote ?? 'origin'}
          initialBranch={gerrit.mode.branch}
          onClose={closeModal}
          onPush={(opts) => gerrit.actions.pushForReview({
            remote: gerrit.detection?.remote ?? 'origin',
            ...opts,
          })}
        />
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
      {modal === 'clone' && (
        <CloneModal
          onClose={closeModal}
          onCloned={repo.methods.loadRepo}
          onOpenIntegrations={() => setModal('github')}
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
      {modal === 'rename-tag' && pendingTag && (
        <InputModal
          title={`Rename tag "${pendingTag}"`}
          subtitle="Recreates the tag at the same commit. A pushed tag keeps its old name on the remote — push the new tag and delete the old one there."
          placeholder="New tag name"
          initialValue={pendingTag}
          confirmLabel="Rename"
          onClose={closeModal}
          onConfirm={async (newName) => {
            const oldName = pendingTag
            closeModal()
            if (newName === oldName) return
            const r = await window.gitApi.renameTag(oldName, newName)
            if (r.success) { repo.toast.success('Tag Renamed', `"${oldName}" → "${newName}".`); repo.methods.refresh() }
            else repo.toast.error('Rename Tag Failed', r.error)
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
    </div>
  )
}
