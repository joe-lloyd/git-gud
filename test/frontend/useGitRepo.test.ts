import { renderHook, act } from '@testing-library/react'
import { vi, expect, describe, it, beforeEach } from 'vitest'
import { useGitRepo } from '../../src/renderer/hooks/useGitRepo'

declare global {
  interface Window {
    gitApi: any;
    githubApi: any;
  }
}

// Mock toast notifications
vi.mock('../../src/renderer/components/Toast/Toast', () => ({
  useToasts: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    toasts: [],
    remove: vi.fn()
  })
}))

describe('useGitRepo Hook', () => {

  beforeEach(() => {
    vi.clearAllMocks()
    
    // Setup healthy mock responses for gitApi
    vi.mocked(window.gitApi.openPath).mockResolvedValue(true)
    vi.mocked(window.gitApi.getLog).mockResolvedValue([
      { sha: '123', shortSha: '123', message: 'test', author: '', email: '', date: '', timestamp: 0, parents: [], refs: [] }  
    ])
    vi.mocked(window.gitApi.getBranches).mockResolvedValue({ local: [{ name: 'main', current: true, sha: '123' }], remote: [] })
  })

  it('loads repo data properly', async () => {
    const { result } = renderHook(() => useGitRepo())

    await act(async () => {
      await result.current.methods.loadRepo('/mock/path')
    })

    expect(window.gitApi.openPath).toHaveBeenCalledWith('/mock/path')
    expect(window.gitApi.getLog).toHaveBeenCalled()
    expect(window.gitApi.getBranches).toHaveBeenCalled()
    
    // Wait for the state updates to settle
    expect(result.current.repoPath).toBe('/mock/path')
    expect(result.current.commits.length).toBe(1)
    expect(result.current.branches.local[0].name).toBe('main')
    expect(result.current.error).toBeNull()
  })

  it('handles git fail gracefully', async () => {
    vi.mocked(window.gitApi.openPath).mockResolvedValue(false)
    
    const { result } = renderHook(() => useGitRepo())

    await act(async () => {
      await result.current.methods.loadRepo('/invalid/path')
    })

    expect(result.current.error).toContain('Not a valid Git repository')
    expect(result.current.repoPath).toBeNull()
  })

  it('calls checkout properly', async () => {
    const { result } = renderHook(() => useGitRepo())

    // First load repo so we have a path
    await act(async () => {
      await result.current.methods.loadRepo('/mock/path')
    })

    // Now checkout
    await act(async () => {
      await result.current.methods.handleCheckout('feature')
    })

    expect(window.gitApi.checkout).toHaveBeenCalledWith('feature')
    // After successful checkout, it should refresh by calling `getLog`, `getBranches` again
    expect(window.gitApi.getLog).toHaveBeenCalledTimes(2) 
  })
  
})

describe('single-tab worktrees', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.gitApi.openPath).mockResolvedValue(true)
    vi.mocked(window.gitApi.getLog).mockResolvedValue([])
    vi.mocked(window.gitApi.getBranches).mockResolvedValue({ local: [], remote: [] })
  })

  it('opening a worktree of an open repo merges into its tab', async () => {
    vi.mocked(window.gitApi.getWorktrees).mockResolvedValue([
      { path: '/repo', branch: 'main', sha: 'a', isMain: true },
      { path: '/repo.worktrees/feat', branch: 'feat', sha: 'b', isMain: false },
    ])
    const { result } = renderHook(() => useGitRepo())

    await act(async () => { await result.current.methods.loadRepo('/repo') })
    expect(result.current.openTabs).toEqual([{ main: '/repo', worktree: '/repo' }])

    await act(async () => { await result.current.methods.loadRepo('/repo.worktrees/feat') })
    // Still ONE tab, now pointing at the worktree
    expect(result.current.openTabs).toEqual([{ main: '/repo', worktree: '/repo.worktrees/feat' }])
    expect(result.current.repoPath).toBe('/repo.worktrees/feat')
    expect(result.current.mainPath).toBe('/repo')
  })

  it('switchWorktree stays in the same tab and persists', async () => {
    vi.mocked(window.gitApi.getWorktrees).mockResolvedValue([
      { path: '/repo', branch: 'main', sha: 'a', isMain: true },
    ])
    const { result } = renderHook(() => useGitRepo())
    await act(async () => { await result.current.methods.loadRepo('/repo') })

    await act(async () => { await result.current.methods.switchWorktree('/repo.worktrees/feat') })
    expect(result.current.repoPath).toBe('/repo.worktrees/feat')
    expect(result.current.mainPath).toBe('/repo')
    expect(result.current.openTabs).toEqual([{ main: '/repo', worktree: '/repo.worktrees/feat' }])
    expect(window.gitApi.saveTabs).toHaveBeenLastCalledWith({
      tabs: [{ main: '/repo', worktree: '/repo.worktrees/feat' }],
      active: '/repo',
    })
  })

  it('restores legacy string-list tabs and lands on the saved worktree', async () => {
    vi.mocked(window.gitApi.getSavedTabs).mockResolvedValue({
      tabs: [{ main: '/repo', worktree: '/repo.worktrees/feat' }],
      active: '/repo',
    })
    vi.mocked(window.gitApi.addTab).mockResolvedValue(true)
    vi.mocked(window.gitApi.activatePath).mockResolvedValue(true)

    const { result } = renderHook(() => useGitRepo())
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    expect(result.current.repoPath).toBe('/repo.worktrees/feat')
    expect(result.current.mainPath).toBe('/repo')
  })

  it('falls back to main when the saved worktree no longer loads', async () => {
    vi.mocked(window.gitApi.getSavedTabs).mockResolvedValue({
      tabs: [{ main: '/repo', worktree: '/gone' }],
      active: '/repo',
    })
    vi.mocked(window.gitApi.addTab).mockImplementation(async (p: string) => p !== '/gone')
    vi.mocked(window.gitApi.activatePath).mockResolvedValue(true)

    const { result } = renderHook(() => useGitRepo())
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    expect(result.current.repoPath).toBe('/repo')
    expect(result.current.openTabs).toEqual([{ main: '/repo', worktree: '/repo' }])
  })
})
