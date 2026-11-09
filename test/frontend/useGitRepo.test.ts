import { renderHook, act } from '@testing-library/react'
import { vi, expect, describe, it, beforeEach } from 'vitest'
import { useGitRepo } from '../../src/renderer/hooks/useGitRepo'

declare global {
  interface Window {
    gitApi: any;
    githubApi: any;
  }
}

// Mock toast notifications — one stable object, so tests can assert on calls
// made from any render.
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  toasts: [],
  remove: vi.fn()
}))
vi.mock('../../src/renderer/components/Toast/Toast', () => ({
  useToasts: () => toastMock
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
    vi.mocked(window.gitApi.isPathGone).mockResolvedValue(false)
    // Session restore runs on mount — keep earlier tests' saved tabs out of it.
    vi.mocked(window.gitApi.getSavedTabs).mockResolvedValue({ tabs: [], active: null })
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
    // The correction is saved, so the next launch doesn't retry '/gone'.
    expect(window.gitApi.saveTabs).toHaveBeenLastCalledWith({
      tabs: [{ main: '/repo', worktree: '/repo' }],
      active: '/repo',
    })
  })

  it('drops back to main when the active worktree is deleted mid-session', async () => {
    vi.mocked(window.gitApi.getWorktrees).mockResolvedValue([
      { path: '/repo', branch: 'main', sha: 'a', isMain: true },
      { path: '/repo.worktrees/feat', branch: 'feat', sha: 'b', isMain: false },
    ])
    const { result } = renderHook(() => useGitRepo())
    await act(async () => { await result.current.methods.loadRepo('/repo.worktrees/feat') })
    expect(result.current.repoPath).toBe('/repo.worktrees/feat')

    // Folder removed outside the app; the next refresh (focus / watcher) notices.
    vi.mocked(window.gitApi.isPathGone).mockImplementation(async (p: string) => p === '/repo.worktrees/feat')
    vi.mocked(window.gitApi.openPath).mockClear()
    await act(async () => { await result.current.methods.refresh() })

    expect(window.gitApi.openPath).toHaveBeenCalledWith('/repo')
    expect(result.current.repoPath).toBe('/repo')
    expect(result.current.mainPath).toBe('/repo')
    expect(result.current.openTabs).toEqual([{ main: '/repo', worktree: '/repo' }])
    expect(window.gitApi.saveTabs).toHaveBeenLastCalledWith({
      tabs: [{ main: '/repo', worktree: '/repo' }],
      active: '/repo',
    })
  })

  it('overlapping refreshes recover from a deleted worktree once', async () => {
    vi.mocked(window.gitApi.getWorktrees).mockResolvedValue([
      { path: '/repo', branch: 'main', sha: 'a', isMain: true },
    ])
    const { result } = renderHook(() => useGitRepo())
    await act(async () => { await result.current.methods.loadRepo('/repo.worktrees/feat') })

    vi.mocked(window.gitApi.isPathGone).mockImplementation(async (p: string) => p === '/repo.worktrees/feat')
    // Hold the switch to main open so the second refresh lands mid-recovery.
    let releaseOpen!: (ok: boolean) => void
    vi.mocked(window.gitApi.openPath).mockReset()
      .mockImplementation(() => new Promise<boolean>((r) => { releaseOpen = r }))
    toastMock.warning.mockClear()

    await act(async () => {
      const first = result.current.methods.refresh()
      const second = result.current.methods.refresh()
      await new Promise((r) => setTimeout(r, 0))
      releaseOpen(true)
      await Promise.all([first, second])
    })

    expect(window.gitApi.openPath).toHaveBeenCalledTimes(1)
    expect(toastMock.warning).toHaveBeenCalledTimes(1)
    expect(toastMock.warning).toHaveBeenCalledWith('Worktree removed', expect.stringContaining('feat'))
    expect(result.current.repoPath).toBe('/repo')
  })

  it('leaves a live worktree alone on refresh', async () => {
    vi.mocked(window.gitApi.getWorktrees).mockResolvedValue([
      { path: '/repo', branch: 'main', sha: 'a', isMain: true },
    ])
    const { result } = renderHook(() => useGitRepo())
    await act(async () => { await result.current.methods.loadRepo('/repo.worktrees/feat') })
    vi.mocked(window.gitApi.openPath).mockClear()
    await act(async () => { await result.current.methods.refresh() })

    expect(window.gitApi.openPath).not.toHaveBeenCalled()
    expect(result.current.repoPath).toBe('/repo.worktrees/feat')
  })

  it('switching to a tab whose worktree vanished lands on main', async () => {
    vi.mocked(window.gitApi.getWorktrees).mockResolvedValue([
      { path: '/repo', branch: 'main', sha: 'a', isMain: true },
    ])
    const { result } = renderHook(() => useGitRepo())
    await act(async () => { await result.current.methods.loadRepo('/repo.worktrees/feat') })
    vi.mocked(window.gitApi.getWorktrees).mockResolvedValue([
      { path: '/other', branch: 'main', sha: 'c', isMain: true },
    ])
    await act(async () => { await result.current.methods.loadRepo('/other') })

    // Main now refuses the deleted worktree (its cached service is dropped).
    vi.mocked(window.gitApi.openPath).mockImplementation(async (p: string) => p !== '/repo.worktrees/feat')
    await act(async () => { await result.current.methods.switchTab('/repo') })

    expect(result.current.repoPath).toBe('/repo')
    expect(result.current.openTabs.find((t) => t.main === '/repo')).toEqual({ main: '/repo', worktree: '/repo' })
  })
})
