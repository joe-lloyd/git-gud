import { useState, useCallback } from 'react'
import type { CommitNode, BranchData, StashInfo, RepoStatus, WorktreeInfo, RemoteInfo } from '../../preload/index'
import { useToasts } from '../components/Toast/Toast'

const EMPTY_BRANCHES: BranchData = { local: [], remote: [] }

export function useGitRepo() {
  const [repoPath, setRepoPath]       = useState<string | null>(null)
  const [commits, setCommits]         = useState<CommitNode[]>([])
  const [branches, setBranches]       = useState<BranchData>(EMPTY_BRANCHES)
  const [stashes, setStashes]         = useState<StashInfo[]>([])
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
      
      const [log, branchData, stashData, st, wt, rmts] = await Promise.all([
        window.gitApi.getLog(2000),
        window.gitApi.getBranches(),
        window.gitApi.getStashes(),
        window.gitApi.getStatus(),
        window.gitApi.getWorktrees(),
        window.gitApi.getRemotes(),
      ])
      window.gitApi.addRecentProject(path)
      setCommits(log)
      setBranches(branchData)
      setStashes(stashData)
      setWorktrees(wt)
      setStatus(st)
      setRemotes(rmts)
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

  return {
    repoPath, setRepoPath,
    commits, setCommits,
    branches, setBranches,
    stashes, setStashes,
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
