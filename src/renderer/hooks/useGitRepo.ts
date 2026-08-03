import { useState, useCallback, useEffect, useRef } from 'react'
import type { CommitNode, BranchData, StashInfo, RepoStatus, WorktreeInfo, RemoteInfo, TagInfo, SavedTab } from '../../preload/index'
import { useToasts } from '../components/Toast/Toast'

const EMPTY_BRANCHES: BranchData = { local: [], remote: [] }

export function useGitRepo() {
  // One tab per repository. `repoPath` is the ACTIVE WORKTREE path (what all
  // git reads/writes target); `mainPath` is the repo's main worktree — the
  // tab's identity. Switching worktrees changes repoPath, never the tab.
  const [repoPath, setRepoPath]       = useState<string | null>(null)
  const [mainPath, setMainPath]       = useState<string | null>(null)
  const [openTabs, setOpenTabs]       = useState<SavedTab[]>([])
  const [commits, setCommits]         = useState<CommitNode[]>([])
  const [branches, setBranches]       = useState<BranchData>(EMPTY_BRANCHES)
  const [stashes, setStashes]         = useState<StashInfo[]>([])
  const [tags, setTags]               = useState<TagInfo[]>([])
  const [worktrees, setWorktrees]     = useState<WorktreeInfo[]>([])
  const [status, setStatus]           = useState<RepoStatus | null>(null)
  const [remotes, setRemotes]         = useState<RemoteInfo[]>([])
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [selectedSha, setSelectedSha] = useState<string | null>(null)

  const toast = useToasts()

  // Clear all repo-scoped state; used when last tab closes or Go Home is pressed.
  const clearRepoState = useCallback(() => {
    setCommits([])
    setBranches(EMPTY_BRANCHES)
    setStashes([])
    setTags([])
    setWorktrees([])
    setStatus(null)
    setRemotes([])
    setSelectedSha(null)
    setError(null)
  }, [])

  const handleGoHome = useCallback(() => {
    // Keep the tabs (services + persisted list) intact — user just wants to
    // visit the welcome screen. Closing tabs would lose the session. We
    // deactivate in main by closing only the ACTIVE service's watcher, via
    // the close-tab IPC on a no-op… actually we leave services alone too;
    // worst case the watcher keeps polling a repo while the user is on home,
    // which is cheap.
    setRepoPath(null)
    setMainPath(null)
    setSelectedSha(null)
    setError(null)
  }, [])

  // Persist the tab list + active tab (fire-and-forget).
  const persistTabs = useCallback((tabs: SavedTab[], active: string | null) => {
    window.gitApi.saveTabs({ tabs, active }).catch(() => {})
  }, [])

  // The repo's main worktree path — the tab's identity. Falls back to the
  // opened path when the worktree listing fails (bare/odd setups).
  const resolveMainPath = useCallback(async (openedPath: string): Promise<string> => {
    try {
      const worktrees = await window.gitApi.getWorktrees()
      return worktrees.find((w) => w.isMain)?.path ?? openedPath
    } catch { return openedPath }
  }, [])

  // Fetch every piece of repo state. Used by both initial load and refresh.
  // Doesn't touch loading state — caller decides whether to show a spinner.
  const fetchAll = useCallback(async () => {
    const [log, branchData, stashData, tagData, st, wt, rmts] = await Promise.all([
      window.gitApi.getLog(2000),
      window.gitApi.getBranches(),
      window.gitApi.getStashes(),
      window.gitApi.getTags(),
      window.gitApi.getStatus(),
      window.gitApi.getWorktrees(),
      window.gitApi.getRemotes(),
    ])
    // Keep the same array reference when the log is truly unchanged — a fresh
    // array every refresh would needlessly re-run the (worker-based) graph
    // layout. But the comparison must include refs and parents, not just SHAs:
    // a `reset`/branch move can leave the SHA list identical (orphaned commits
    // stay reachable via origin/*) while HEAD/branch pills move to another node.
    // Comparing SHAs alone froze those pills at the old tip after a hard reset.
    setCommits((prev) =>
      prev.length === log.length &&
      prev.every((c, i) =>
        c.sha === log[i].sha &&
        c.refs.join('\x1f') === log[i].refs.join('\x1f') &&
        c.parents.join(' ') === log[i].parents.join(' '),
      )
        ? prev
        : log,
    )
    setBranches(branchData)
    setStashes(stashData)
    setTags(tagData)
    setWorktrees(wt)
    setStatus(st)
    setRemotes(rmts)
  }, [])

  // Open a repo (or one of its worktrees). Opening any worktree of an
  // already-open repository merges into that repo's single tab. Main is
  // idempotent: openPath re-activates if already loaded, otherwise creates
  // the GitService.
  const loadRepo = useCallback(async (path: string) => {
    setLoading(true); setError(null); setSelectedSha(null)
    try {
      const ok = await window.gitApi.openPath(path)
      if (!ok) throw new Error('Not a valid Git repository or path does not exist.')
      const main = await resolveMainPath(path)
      await fetchAll()
      window.gitApi.addRecentProject(main)
      setRepoPath(path)
      setMainPath(main)
      setOpenTabs((prev) => {
        const exists = prev.some((t) => t.main === main)
        const next = exists
          ? prev.map((t) => (t.main === main ? { ...t, worktree: path } : t))
          : [...prev, { main, worktree: path }]
        persistTabs(next, main)
        return next
      })
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [fetchAll, resolveMainPath, persistTabs])

  // Switch to an already-open tab — lands on whichever worktree was active
  // in it. A worktree deleted since then falls back to the main worktree.
  const switchTab = useCallback(async (main: string) => {
    if (main === mainPath) return
    const tab = openTabs.find((t) => t.main === main)
    if (!tab) return
    setLoading(true); setError(null); setSelectedSha(null)
    try {
      let target = tab.worktree
      let ok = await window.gitApi.openPath(target)
      if (!ok && target !== tab.main) {
        target = tab.main
        ok = await window.gitApi.openPath(target)
      }
      if (!ok) throw new Error(`Tab "${main}" is not loadable.`)
      await fetchAll()
      setRepoPath(target)
      setMainPath(main)
      setOpenTabs((prev) => {
        const next = prev.map((t) => (t.main === main ? { ...t, worktree: target } : t))
        persistTabs(next, main)
        return next
      })
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [mainPath, openTabs, fetchAll, persistTabs])

  // Switch the active worktree WITHIN the current tab — worktrees are a
  // feature of the repo, not separate projects.
  const switchWorktree = useCallback(async (path: string) => {
    if (!mainPath || path === repoPath) return
    const ok = await window.gitApi.openPath(path)
    if (!ok) { toast.error('Worktree unavailable', path); return }
    setSelectedSha(null)
    setRepoPath(path)
    setOpenTabs((prev) => {
      const next = prev.map((t) => (t.main === mainPath ? { ...t, worktree: path } : t))
      persistTabs(next, mainPath)
      return next
    })
    await fetchAll().catch(() => {})
  }, [mainPath, repoPath, fetchAll, persistTabs, toast])

  // Close a tab. If it was active, fall back to another open tab (or Welcome).
  const closeTab = useCallback(async (main: string) => {
    const tab = openTabs.find((t) => t.main === main)
    await window.gitApi.closeTab(main, tab && tab.worktree !== main ? [tab.worktree] : [])
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.main !== main)
      if (main === mainPath) {
        const fallback = next[next.length - 1] ?? null
        if (fallback) {
          // Fire-and-forget — async swap, UI will catch up on next render
          window.gitApi.openPath(fallback.worktree).then((ok) => {
            const target = ok ? fallback.worktree : fallback.main
            if (!ok) window.gitApi.openPath(fallback.main).catch(() => {})
            setRepoPath(target)
            setMainPath(fallback.main)
            fetchAll().catch(() => {})
          })
          persistTabs(next, fallback.main)
        } else {
          setRepoPath(null)
          setMainPath(null)
          clearRepoState()
          persistTabs(next, null)
        }
      } else {
        persistTabs(next, mainPath)
      }
      return next
    })
  }, [openTabs, mainPath, fetchAll, clearRepoState, persistTabs])

  // Silent refresh — no spinner, no openPath. Just re-reads state using the
  // existing gitService in main. Used by focus, FS-watcher, and post-mutation
  // refresh. Failure leaves the UI on its previous data (no flashes).
  const refresh = useCallback(async () => {
    if (!repoPath) return
    try { await fetchAll() } catch { /* keep prior state on transient failure */ }
  }, [repoPath, fetchAll])

  // Always call the *latest* refresh from listeners — avoids stale closures
  const refreshRef = useRef(refresh)
  useEffect(() => { refreshRef.current = refresh }, [refresh])

  // Refresh on window focus (catches external CLI ops while app was blurred)
  useEffect(() => {
    const onFocus = () => refreshRef.current()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // Refresh on FS-watcher notification from main (debounced 200 ms)
  useEffect(() => {
    if (!repoPath) return
    return window.gitApi.onRepoChanged(() => refreshRef.current())
  }, [repoPath])

  // Restore the previous session's tabs on first mount. Each path is loaded
  // headlessly via addTab; only the last-active one is activated so the user
  // lands exactly where they left off. Stale paths (repo deleted/moved) are
  // silently dropped from the restored list.
  const didRestoreRef = useRef(false)
  useEffect(() => {
    if (didRestoreRef.current) return
    didRestoreRef.current = true
    ;(async () => {
      const saved = await window.gitApi.getSavedTabs().catch(() => null)
      if (!saved || saved.tabs.length === 0) return
      setLoading(true)
      try {
        // Load each tab headlessly, preferring its saved worktree and falling
        // back to the main worktree when the worktree folder is gone.
        const loaded: SavedTab[] = []
        for (const tab of saved.tabs) {
          if (await window.gitApi.addTab(tab.worktree).catch(() => false)) {
            loaded.push(tab)
          } else if (tab.worktree !== tab.main && await window.gitApi.addTab(tab.main).catch(() => false)) {
            loaded.push({ main: tab.main, worktree: tab.main })
          }
        }
        if (loaded.length === 0) return
        setOpenTabs(loaded)
        const target = loaded.find((t) => t.main === saved.active) ?? loaded[loaded.length - 1]
        const ok = await window.gitApi.activatePath(target.worktree).catch(() => false)
        if (!ok) return
        setRepoPath(target.worktree)
        setMainPath(target.main)
        await fetchAll().catch(() => {})
      } finally {
        setLoading(false)
      }
    })()
  }, [fetchAll])

  const handleOpenRepo = useCallback(async () => {
    const path = await window.gitApi.openDialog()
    if (path) await loadRepo(path)
  }, [loadRepo])

  const handleCheckout = useCallback(async (branch: string) => {
    const result = await window.gitApi.checkout(branch)
    if (result.success) await refresh()
    else if (result.error) toast.error('Checkout failed', result.error)
  }, [refresh, toast])

  const handleFetch  = useCallback(async () => {
    const r = await window.gitApi.fetch()
    if (r.success) refresh()
    else toast.warning('Fetch failed', r.error)
  }, [refresh, toast])

  const handlePush   = useCallback(async (force = false) => {
    const r = await window.gitApi.push(force)
    if (r.success) {
      if (force) toast.success('Force pushed', 'Remote branch now matches your local branch.')
      refresh()
    } else if (force && /stale info|remote ref.+has changed/i.test(r.error ?? '')) {
      // --force-with-lease refused: the remote moved past our last fetch.
      toast.warning('Force push refused', 'The remote has new commits you haven\'t fetched. Fetch first, review, then retry.')
    } else {
      toast.error(force ? 'Force push failed' : 'Push failed', r.error)
    }
  }, [refresh, toast])

  return {
    repoPath, setRepoPath,
    mainPath,
    openTabs,
    commits, setCommits,
    branches, setBranches,
    stashes, setStashes,
    tags, setTags,
    worktrees, setWorktrees,
    status, setStatus,
    remotes, setRemotes,
    loading, setLoading,
    error, setError,
    selectedSha, setSelectedSha,
    toast,
    methods: {
      handleGoHome,
      loadRepo,
      switchTab,
      switchWorktree,
      closeTab,
      refresh,
      handleOpenRepo,
      handleCheckout,
      handleFetch,
      handlePush
    }
  }
}
