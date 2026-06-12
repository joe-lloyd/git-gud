import { useState, useCallback, useEffect, useRef } from 'react'
import type { CommitNode, BranchData, StashInfo, RepoStatus, WorktreeInfo, RemoteInfo, TagInfo } from '../../preload/index'
import { useToasts } from '../components/Toast/Toast'

const EMPTY_BRANCHES: BranchData = { local: [], remote: [] }

export function useGitRepo() {
  const [repoPath, setRepoPath]       = useState<string | null>(null)
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

  const handleGoHome = useCallback(() => {
    setRepoPath(null)
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

  const loadRepo = useCallback(async (path: string) => {
    setLoading(true); setError(null); setSelectedSha(null)
    try {
      const ok = await window.gitApi.openPath(path)
      if (!ok) throw new Error('Not a valid Git repository or path does not exist.')

      const [log, branchData, stashData, tagData, st, wt, rmts] = await Promise.all([
        window.gitApi.getLog(2000),
        window.gitApi.getBranches(),
        window.gitApi.getStashes(),
        window.gitApi.getTags(),
        window.gitApi.getStatus(),
        window.gitApi.getWorktrees(),
        window.gitApi.getRemotes(),
      ])
      window.gitApi.addRecentProject(path)
      setCommits(log)
      setBranches(branchData)
      setStashes(stashData)
      setTags(tagData)
      setWorktrees(wt)
      setStatus(st)
      setRemotes(rmts)
      setRepoPath(path)
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [])

  const refresh = useCallback(() => { if (repoPath) loadRepo(repoPath) }, [repoPath, loadRepo])

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
    const r = await window.gitApi.fetch()
    if (r.success) refresh()
    else toast.warning('Fetch failed', r.error)
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

  return {
    repoPath, setRepoPath,
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
      refresh,
      handleOpenRepo,
      handleCheckout,
      handleFetch,
      handlePull,
      handlePush
    }
  }
}
