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
