import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Main-process integration tests opt into `// @vitest-environment node`, where
// there is no window. The preload mocks below are irrelevant there — give them
// a harmless target so this shared setup file still loads.
if (typeof (globalThis as any).window === 'undefined') (globalThis as any).window = globalThis

// Mock the globally injected GitHub and Git API object from Preload layer
Object.defineProperty(window, 'gitApi', {
  value: {
    openDialog: vi.fn(),
    getUpdateChannel: vi.fn().mockResolvedValue('stable'),
    setUpdateChannel: vi.fn().mockResolvedValue({ success: true }),
    openPath: vi.fn(),
    activatePath: vi.fn().mockResolvedValue(true),
    addTab: vi.fn().mockResolvedValue(true),
    closeTab: vi.fn().mockResolvedValue(true),
    getActivePath: vi.fn().mockResolvedValue(null),
    getOpenTabs: vi.fn().mockResolvedValue([]),
    getSavedTabs: vi.fn().mockResolvedValue({ tabs: [], active: null }),
    saveTabs: vi.fn().mockResolvedValue(true),
    getLog: vi.fn().mockResolvedValue([]),
    getBranches: vi.fn().mockResolvedValue({ local: [], remote: [] }),
    getTags: vi.fn().mockResolvedValue([]),
    getStashes: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn().mockResolvedValue(null),
    getRemotes: vi.fn().mockResolvedValue([]),
    getOtherRefNamespaces: vi.fn().mockResolvedValue([]),
    getCommitDiff: vi.fn(),
    getCommitFiles: vi.fn().mockResolvedValue([]),
    getFileDiff: vi.fn(),
    getCommitFileDiff: vi.fn().mockResolvedValue(''),
    checkout: vi.fn().mockResolvedValue({ success: true }),
    stage: vi.fn().mockResolvedValue({ success: true }),
    unstage: vi.fn().mockResolvedValue({ success: true }),
    commit: vi.fn().mockResolvedValue({ success: true }),
    stashSave: vi.fn().mockResolvedValue({ success: true }),
    stashPop: vi.fn().mockResolvedValue({ success: true }),
    stashDrop: vi.fn().mockResolvedValue({ success: true }),
    stashApply: vi.fn().mockResolvedValue({ success: true }),
    fetch: vi.fn().mockResolvedValue({ success: true }),
    pull: vi.fn().mockResolvedValue({ success: true }),
    fastForwardBranch: vi.fn().mockResolvedValue({ success: true }),
    push: vi.fn().mockResolvedValue({ success: true }),
    createBranch: vi.fn().mockResolvedValue({ success: true }),
    deleteBranch: vi.fn().mockResolvedValue({ success: true }),
    renameBranch: vi.fn().mockResolvedValue({ success: true }),
    deleteRemoteBranch: vi.fn().mockResolvedValue({ success: true }),
    merge: vi.fn().mockResolvedValue({ success: true }),
    mergeCurrentInto: vi.fn().mockResolvedValue({ success: true }),
    cherryPick: vi.fn().mockResolvedValue({ success: true }),
    revert: vi.fn().mockResolvedValue({ success: true }),
    reset: vi.fn().mockResolvedValue({ success: true }),
    rebaseTo: vi.fn().mockResolvedValue({ success: true }),
    cherryPickMany: vi.fn().mockResolvedValue({ success: true, autoFixed: false, steps: [] }),
    revertMany: vi.fn().mockResolvedValue({ success: true, autoFixed: false, steps: [] }),
    opContinue: vi.fn().mockResolvedValue({ success: true }),
    opAbort: vi.fn().mockResolvedValue({ success: true }),
    opSkip: vi.fn().mockResolvedValue({ success: true }),
    markResolved: vi.fn().mockResolvedValue({ success: true }),
    getConflictFile: vi.fn().mockResolvedValue({ path: '', sections: [] }),
    writeFile: vi.fn().mockResolvedValue({ success: true }),
    rerereStatus: vi.fn().mockResolvedValue([]),
    rerereForget: vi.fn().mockResolvedValue({ success: true }),
    createTag: vi.fn().mockResolvedValue({ success: true }),
    runDragAction: vi.fn().mockResolvedValue({ success: true }),
    getWorktrees: vi.fn().mockResolvedValue([]),
    addWorktree: vi.fn().mockResolvedValue({ success: true }),
    removeWorktree: vi.fn().mockResolvedValue({ success: true }),
    bisectStart: vi.fn().mockResolvedValue({ success: true }),
    bisectGood: vi.fn().mockResolvedValue(''),
    bisectBad: vi.fn().mockResolvedValue(''),
    bisectReset: vi.fn().mockResolvedValue({ success: true }),
    formatPatch: vi.fn().mockResolvedValue(''),
    applyPatch: vi.fn().mockResolvedValue({ success: true }),
    getReflog: vi.fn().mockResolvedValue([]),
    onGitignoreChanged: vi.fn(),
    onRepoChanged: vi.fn(() => () => {}),
    getRecentProjects: vi.fn().mockResolvedValue([]),
    addRecentProject: vi.fn().mockResolvedValue(undefined),
    addRemote: vi.fn().mockResolvedValue({ success: true }),
    cloneDialog: vi.fn().mockResolvedValue(null),
    defaultCloneDir: vi.fn().mockResolvedValue('/home/user'),
    clone: vi.fn().mockResolvedValue({ success: true, path: '/home/user/repo' }),
    onCloneProgress: vi.fn(() => () => {}),
    getConfig: vi.fn().mockResolvedValue(''),
    setConfig: vi.fn().mockResolvedValue({ success: true }),
  },
})

Object.defineProperty(window, 'githubApi', {
  value: {
    startDeviceFlow: vi.fn(),
    pollToken: vi.fn(),
    logout: vi.fn(),
    getUser: vi.fn().mockResolvedValue(null),
    createRepo: vi.fn(),
    listRepos: vi.fn().mockResolvedValue({ success: true, repos: [] }),
  }
})

Object.defineProperty(window, 'uiApi', {
  value: {
    setZoomFactor: vi.fn(),
    getZoomFactor: vi.fn(() => 1),
    openExternal: vi.fn().mockResolvedValue(true),
    showInFolder: vi.fn().mockResolvedValue(true),
  }
})

Object.defineProperty(window, 'gerritApi', {
  value: {
    detect: vi.fn().mockResolvedValue({ likely: false, signals: [] }),
    pushForReview: vi.fn().mockResolvedValue({ success: true }),
    listChanges: vi.fn().mockResolvedValue({ success: true, changes: [], auth: 'anonymous' }),
    syncChangeRefs: vi.fn().mockResolvedValue({ success: true, fetched: 0, pruned: 0 }),
    clearChangeRefs: vi.fn().mockResolvedValue(0),
    setAuth: vi.fn().mockResolvedValue({ success: true }),
    clearAuth: vi.fn().mockResolvedValue(true),
    authStatus: vi.fn().mockResolvedValue(false),
  }
})

Object.defineProperty(window, 'peerApi', {
  value: {
    getState: vi.fn().mockResolvedValue(null),
    onState: vi.fn(() => () => {}),
    setServer: vi.fn().mockResolvedValue(null),
    regenerateCode: vi.fn().mockResolvedValue('000000'),
    revokeDevice: vi.fn(),
    setDeviceReadOnly: vi.fn().mockResolvedValue(true),
    setDeviceScopes: vi.fn().mockResolvedValue(true),
    pairingQr: vi.fn().mockResolvedValue(null),
    pairPayload: vi.fn().mockResolvedValue({ success: false, error: 'mock' }),
    probe: vi.fn().mockResolvedValue({ success: false, error: 'n/a' }),
    pair: vi.fn().mockResolvedValue({ success: false, error: 'n/a' }),
    connect: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn().mockResolvedValue(true),
    forget: vi.fn().mockResolvedValue([]),
    listRepos: vi.fn().mockResolvedValue({ success: true, repos: [] }),
    repoPath: vi.fn(async (id: string, p: string) => `gitgud-peer://${id}/${p.replace(/^\/+/, '')}`),
    statusFor: vi.fn().mockResolvedValue(null),
  }
})

Object.defineProperty(window, 'providerApi', {
  value: {
    signInGitLab: vi.fn(),
    signInBitbucket: vi.fn(),
    signOut: vi.fn(),
    getUser: vi.fn().mockResolvedValue(null),
    createRepo: vi.fn(),
    listRepos: vi.fn().mockResolvedValue({ success: true, repos: [] }),
  }
})
