import { useState, useCallback, useEffect, useRef } from 'react'
import type { CommitNode, BranchData, StashInfo, RepoStatus, WorktreeInfo, RemoteInfo, TagInfo } from '../../preload/index'
import { useToasts } from '../components/Toast/Toast'

const EMPTY_BRANCHES: BranchData = { local: [], remote: [] }

export function useGitRepo() {
  const [repoPath, setRepoPath]       = useState<string | null>(null)
  const [openTabs, setOpenTabs]       = useState<string[]>([])
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
    setSelectedSha(null)
    setError(null)
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
    // Keep the same array reference when the log is unchanged (same SHAs in the
    // same order) — a fresh array every refresh would needlessly re-run the
    // (now sometimes worker-based) graph layout. Compare cheaply by SHA list.
    setCommits((prev) =>
      prev.length === log.length && prev.every((c, i) => c.sha === log[i].sha) ? prev : log,
    )
    setBranches(branchData)
    setStashes(stashData)
    setTags(tagData)
    setWorktrees(wt)
    setStatus(st)
    setRemotes(rmts)
  }, [])

  // Open a repo as a new tab (or focus existing). Main is idempotent: openPath
  // re-activates if already loaded, otherwise creates the GitService.
  const loadRepo = useCallback(async (path: string) => {
    setLoading(true); setError(null); setSelectedSha(null)
    try {
      const ok = await window.gitApi.openPath(path)
      if (!ok) throw new Error('Not a valid Git repository or path does not exist.')
      await fetchAll()
      window.gitApi.addRecentProject(path)
      setRepoPath(path)
      setOpenTabs((prev) => prev.includes(path) ? prev : [...prev, path])
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [fetchAll])

  // Switch to an already-open tab (no openPath needed).
  const switchTab = useCallback(async (path: string) => {
    if (path === repoPath) return
    setLoading(true); setError(null); setSelectedSha(null)
    try {
      const ok = await window.gitApi.activatePath(path)
      if (!ok) throw new Error(`Tab "${path}" is not loaded.`)
      await fetchAll()
      setRepoPath(path)
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [repoPath, fetchAll])

  // Close a tab. If it was active, fall back to another open tab (or Welcome).
  const closeTab = useCallback(async (path: string) => {
    await window.gitApi.closeTab(path)
    setOpenTabs((prev) => {
      const next = prev.filter(p => p !== path)
      if (path === repoPath) {
        const fallback = next[next.length - 1] ?? null
        if (fallback) {
          // Fire-and-forget — async swap, UI will catch up on next render
          window.gitApi.activatePath(fallback).then(() => {
            setRepoPath(fallback)
            fetchAll().catch(() => {})
          })
        } else {
          setRepoPath(null)
          clearRepoState()
        }
      }
      return next
    })
  }, [repoPath, fetchAll, clearRepoState])

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
        const loaded: string[] = []
        for (const path of saved.tabs) {
          const ok = await window.gitApi.addTab(path).catch(() => false)
          if (ok) loaded.push(path)
        }
        if (loaded.length === 0) return
        setOpenTabs(loaded)
        const target = saved.active && loaded.includes(saved.active) ? saved.active : loaded[loaded.length - 1]
        const ok = await window.gitApi.activatePath(target).catch(() => false)
        if (!ok) return
        setRepoPath(target)
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

  const handlePush   = useCallback(async () => {
    const r = await window.gitApi.push()
    if (r.success) refresh()
    else toast.error('Push failed', r.error)
  }, [refresh, toast])

  return {
    repoPath, setRepoPath,
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
      closeTab,
      refresh,
      handleOpenRepo,
      handleCheckout,
      handleFetch,
      handlePush
    }
  }
}
