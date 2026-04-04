import { contextBridge, ipcRenderer } from 'electron'

export type CommitNode = {
  sha: string
  shortSha: string
  message: string
  author: string
  email: string
  date: string
  timestamp: number
  parents: string[]
  refs: string[]
}

export type BranchInfo = {
  name: string
  current: boolean
  sha: string
  remote?: string
}

export type BranchData = {
  local: BranchInfo[]
  remote: BranchInfo[]
}

export type TagInfo = { name: string; sha: string }
export type StashInfo = { index: number; message: string; sha: string }
export type WorktreeInfo = { path: string; branch: string; sha: string; isMain: boolean }
export type FileChange = { path: string; status: string; add?: number; del?: number }
export type RepoStatus = {
  staged: FileChange[]
  unstaged: FileChange[]
  untracked: string[]
  branch: string
  ahead: number
  behind: number
}

export type RemoteInfo = {
  name: string
  url: string
}

export type GitHubUser = {
  login: string
  avatar_url: string
  name: string | null
}

export type GitHubRepo = {
  name: string
  full_name: string
  html_url: string
  ssh_url: string
  clone_url: string
}

const gitApi = {
  openDialog: (): Promise<string | null> => ipcRenderer.invoke('git:open-dialog'),
  openPath: (path: string): Promise<boolean> => ipcRenderer.invoke('git:open-path', path),

  getLog: (limit?: number): Promise<CommitNode[]> => ipcRenderer.invoke('git:log', limit),
  getBranches: (): Promise<BranchData> => ipcRenderer.invoke('git:branches'),
  getTags: (): Promise<TagInfo[]> => ipcRenderer.invoke('git:tags'),
  getStashes: (): Promise<StashInfo[]> => ipcRenderer.invoke('git:stashes'),
  getStatus: (): Promise<RepoStatus | null> => ipcRenderer.invoke('git:status'),
  getRemotes: (): Promise<RemoteInfo[]> => ipcRenderer.invoke('git:remotes'),

  getCommitDiff: (sha: string): Promise<string> => ipcRenderer.invoke('git:commit-diff', sha),
  getCommitFiles: (sha: string): Promise<FileChange[]> => ipcRenderer.invoke('git:commit-files', sha),
  getFileDiff: (filePath: string, staged: boolean): Promise<string> => ipcRenderer.invoke('git:file-diff', filePath, staged),


  checkout: (branch: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('git:checkout', branch),

  stage: (files: string[]): Promise<boolean> => ipcRenderer.invoke('git:stage', files),
  unstage: (files: string[]): Promise<boolean> => ipcRenderer.invoke('git:unstage', files),
  commit: (message: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('git:commit', message),

  stashSave: (message?: string): Promise<boolean> => ipcRenderer.invoke('git:stash-save', message),
  stashPop: (index: number): Promise<boolean> => ipcRenderer.invoke('git:stash-pop', index),
  stashDrop: (index: number): Promise<boolean> => ipcRenderer.invoke('git:stash-drop', index),

  fetch: (): Promise<boolean> => ipcRenderer.invoke('git:fetch'),
  pull: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('git:pull'),
  push: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('git:push'),

  createBranch: (name: string, startPoint?: string): Promise<boolean> =>
    ipcRenderer.invoke('git:create-branch', name, startPoint),
  deleteBranch: (name: string, force?: boolean): Promise<boolean> =>
    ipcRenderer.invoke('git:delete-branch', name, force),
  merge: (branch: string): Promise<boolean> => ipcRenderer.invoke('git:merge', branch),
  cherryPick: (sha: string): Promise<boolean> => ipcRenderer.invoke('git:cherry-pick', sha),

  getWorktrees: (): Promise<WorktreeInfo[]> => ipcRenderer.invoke('git:worktrees'),
  addWorktree: (path: string, branch: string): Promise<boolean> =>
    ipcRenderer.invoke('git:worktree-add', path, branch),
  removeWorktree: (path: string): Promise<boolean> => ipcRenderer.invoke('git:worktree-remove', path),

  bisectStart: (): Promise<boolean> => ipcRenderer.invoke('git:bisect-start'),
  bisectGood: (sha?: string): Promise<string> => ipcRenderer.invoke('git:bisect-good', sha),
  bisectBad: (sha?: string): Promise<string> => ipcRenderer.invoke('git:bisect-bad', sha),
  bisectReset: (): Promise<boolean> => ipcRenderer.invoke('git:bisect-reset'),

  formatPatch: (sha: string): Promise<string> => ipcRenderer.invoke('git:format-patch', sha),
  applyPatch: (patchContent: string, opts?: { reverse?: boolean, cached?: boolean }): Promise<boolean> =>
    ipcRenderer.invoke('git:apply-patch', patchContent, opts),

  getReflog: (limit?: number): Promise<CommitNode[]> => ipcRenderer.invoke('git:reflog', limit),

  onGitignoreChanged: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('git:gitignore-changed', handler)
    return () => { ipcRenderer.removeListener('git:gitignore-changed', handler) }
  },

  getRecentProjects: (): Promise<string[]> => ipcRenderer.invoke('app:get-recent'),
  addRecentProject: (path: string): Promise<void> => ipcRenderer.invoke('app:add-recent', path),

  addRemote: (name: string, url: string): Promise<{success: boolean, error?: string}> => ipcRenderer.invoke('git:add-remote', name, url),
}

export type DeviceFlowConfig = {
  device_code: string
  user_code: string
  verification_uri: string
  interval: number
}

const githubApi = {
  startDeviceFlow: (clientId: string): Promise<{ success: boolean; flow?: DeviceFlowConfig; error?: string }> => ipcRenderer.invoke('github:start-device-flow', clientId),
  pollToken: (clientId: string, deviceCode: string): Promise<{ success: boolean; user?: GitHubUser; error?: string }> => ipcRenderer.invoke('github:poll-token', clientId, deviceCode),
  logout: (): Promise<boolean> => ipcRenderer.invoke('github:logout'),
  getUser: (): Promise<GitHubUser | null> => ipcRenderer.invoke('github:get-user'),
  createRepo: (name: string, description: string, isPrivate: boolean): Promise<{ success: boolean; repo?: GitHubRepo; error?: string }> => ipcRenderer.invoke('github:create-repo', name, description, isPrivate),
  listRepos: (): Promise<{ success: boolean; repos?: GitHubRepo[]; error?: string }> => ipcRenderer.invoke('github:list-repos'),
}

contextBridge.exposeInMainWorld('gitApi', gitApi)
contextBridge.exposeInMainWorld('githubApi', githubApi)

// Type helper for renderer
export type GitApi = typeof gitApi
export type GitHubApi = typeof githubApi
