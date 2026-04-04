import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock the globally injected GitHub and Git API object from Preload layer
Object.defineProperty(window, 'gitApi', {
  value: {
    openDialog: vi.fn(),
    openPath: vi.fn(),
    getLog: vi.fn().mockResolvedValue([]),
    getBranches: vi.fn().mockResolvedValue({ local: [], remote: [] }),
    getTags: vi.fn().mockResolvedValue([]),
    getStashes: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn().mockResolvedValue(null),
    getRemotes: vi.fn().mockResolvedValue([]),
    getCommitDiff: vi.fn(),
    getCommitFiles: vi.fn().mockResolvedValue([]),
    getFileDiff: vi.fn(),
    checkout: vi.fn().mockResolvedValue({ success: true }),
    stage: vi.fn().mockResolvedValue(true),
    unstage: vi.fn().mockResolvedValue(true),
    commit: vi.fn().mockResolvedValue({ success: true }),
    stashSave: vi.fn().mockResolvedValue(true),
    stashPop: vi.fn().mockResolvedValue(true),
    stashDrop: vi.fn().mockResolvedValue(true),
    fetch: vi.fn().mockResolvedValue(true),
    pull: vi.fn().mockResolvedValue({ success: true }),
    push: vi.fn().mockResolvedValue({ success: true }),
    createBranch: vi.fn().mockResolvedValue(true),
    deleteBranch: vi.fn().mockResolvedValue(true),
    merge: vi.fn().mockResolvedValue(true),
    cherryPick: vi.fn().mockResolvedValue(true),
    getWorktrees: vi.fn().mockResolvedValue([]),
    addWorktree: vi.fn().mockResolvedValue(true),
    removeWorktree: vi.fn().mockResolvedValue(true),
    bisectStart: vi.fn().mockResolvedValue(true),
    bisectGood: vi.fn().mockResolvedValue(''),
    bisectBad: vi.fn().mockResolvedValue(''),
    bisectReset: vi.fn().mockResolvedValue(true),
    formatPatch: vi.fn().mockResolvedValue(''),
    applyPatch: vi.fn().mockResolvedValue(true),
    getReflog: vi.fn().mockResolvedValue([]),
    onGitignoreChanged: vi.fn(),
    getRecentProjects: vi.fn().mockResolvedValue([]),
    addRecentProject: vi.fn().mockResolvedValue(undefined),
    addRemote: vi.fn().mockResolvedValue({ success: true })
  },
})

Object.defineProperty(window, 'githubApi', {
  value: {
    startDeviceFlow: vi.fn(),
    pollToken: vi.fn(),
    logout: vi.fn(),
    getUser: vi.fn(),
    createRepo: vi.fn(),
    listRepos: vi.fn(),
  }
})
