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
  conflict?: ConflictState
}

// Snapshot of in-flight merge/rebase. Empty conflictedFiles + inMerge/inRebase
// true means git is awaiting `--continue` (resolutions all staged). When all
// three are falsy/empty, the repo is in a normal state.
export type ConflictState = {
  inMerge: boolean
  inRebase: boolean
  rebaseKind?: 'apply' | 'merge'   // --rebase-apply for non-interactive, --rebase-merge for -i
  conflictedFiles: string[]
}

// Parsed conflicted file — sections in order. Shared sections come straight
// from the file; conflict sections carry the rival texts so the UI can offer
// "take current" / "take incoming" / hand-edit.
export type ConflictFile = {
  path: string
  sections: ConflictSection[]
}
export type ConflictSection =
  | { kind: 'shared';   text: string }
  | { kind: 'conflict'; current: string; incoming: string; currentLabel: string; incomingLabel: string }

export type RemoteInfo = {
  name: string
  url: string
}

export type Result = { success: true } | { success: false; error: string }
// Pull carries an extra classifier so the renderer can offer targeted recovery
// (stash + retry for dirty trees, merge/rebase choice for diverged history).
export type PullErrorKind = 'dirty' | 'diverged' | 'untracked' | 'conflict' | 'auth' | 'unknown'
export type PullResult =
  | { success: true }
  | { success: false; error: string; kind?: PullErrorKind }

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
  addTab: (path: string): Promise<boolean> => ipcRenderer.invoke('git:add-tab', path),
  activatePath: (path: string): Promise<boolean> => ipcRenderer.invoke('git:activate-path', path),
  closeTab: (path: string): Promise<boolean> => ipcRenderer.invoke('git:close-tab', path),
  getActivePath: (): Promise<string | null> => ipcRenderer.invoke('git:active-path'),
  getOpenTabs: (): Promise<string[]> => ipcRenderer.invoke('git:open-tabs'),
  getSavedTabs: (): Promise<{ tabs: string[]; active: string | null }> =>
    ipcRenderer.invoke('app:get-saved-tabs'),

  getLog: (limit?: number): Promise<CommitNode[]> => ipcRenderer.invoke('git:log', limit),
  getBranches: (): Promise<BranchData> => ipcRenderer.invoke('git:branches'),
  getTags: (): Promise<TagInfo[]> => ipcRenderer.invoke('git:tags'),
  getStashes: (): Promise<StashInfo[]> => ipcRenderer.invoke('git:stashes'),
  getStatus: (): Promise<RepoStatus | null> => ipcRenderer.invoke('git:status'),
  getRemotes: (): Promise<RemoteInfo[]> => ipcRenderer.invoke('git:remotes'),

  getCommitDiff: (sha: string): Promise<string> => ipcRenderer.invoke('git:commit-diff', sha),
  getCommitFiles: (sha: string): Promise<FileChange[]> => ipcRenderer.invoke('git:commit-files', sha),
  getFileDiff: (filePath: string, staged: boolean, opts?: { wordDiff?: boolean }): Promise<string> =>
    ipcRenderer.invoke('git:file-diff', filePath, staged, opts),
  getCommitFileDiff: (sha: string, filePath: string, opts?: { wordDiff?: boolean }): Promise<string> =>
    ipcRenderer.invoke('git:commit-file-diff', sha, filePath, opts),


  checkout: (branch: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('git:checkout', branch),

  stage: (files: string[]): Promise<Result> => ipcRenderer.invoke('git:stage', files),
  unstage: (files: string[]): Promise<Result> => ipcRenderer.invoke('git:unstage', files),
  discardChanges: (files: string[], opts: { staged: boolean }): Promise<Result> =>
    ipcRenderer.invoke('git:discard-changes', files, opts),
  discardUntracked: (files: string[]): Promise<Result> =>
    ipcRenderer.invoke('git:discard-untracked', files),
  commit: (message: string): Promise<Result> =>
    ipcRenderer.invoke('git:commit', message),
  commitAmend: (message: string): Promise<Result> =>
    ipcRenderer.invoke('git:commit-amend', message),
  getHeadMessage: (): Promise<string> => ipcRenderer.invoke('git:head-message'),
  logPickaxe: (query: string, limit: number): Promise<CommitNode[]> =>
    ipcRenderer.invoke('git:log-pickaxe', query, limit),

  stashSave: (message?: string): Promise<Result> => ipcRenderer.invoke('git:stash-save', message),
  stashPop: (index: number): Promise<Result> => ipcRenderer.invoke('git:stash-pop', index),
  stashDrop: (index: number): Promise<Result> => ipcRenderer.invoke('git:stash-drop', index),
  stashApply: (index: number): Promise<Result> => ipcRenderer.invoke('git:stash-apply', index),
  stashBranch: (name: string, index: number): Promise<Result> =>
    ipcRenderer.invoke('git:stash-branch', name, index),

  fetch: (): Promise<Result> => ipcRenderer.invoke('git:fetch'),
  pull: (opts?: { rebase?: boolean; autoStash?: boolean }): Promise<PullResult> =>
    ipcRenderer.invoke('git:pull', opts),
  push: (): Promise<Result> => ipcRenderer.invoke('git:push'),

  createBranch: (name: string, startPoint?: string): Promise<Result> =>
    ipcRenderer.invoke('git:create-branch', name, startPoint),
  deleteBranch: (name: string, force?: boolean): Promise<Result> =>
    ipcRenderer.invoke('git:delete-branch', name, force),
  renameBranch: (oldName: string, newName: string): Promise<Result> =>
    ipcRenderer.invoke('git:rename-branch', oldName, newName),
  deleteRemoteBranch: (remote: string, branch: string): Promise<Result> =>
    ipcRenderer.invoke('git:delete-remote-branch', remote, branch),
  merge: (branch: string): Promise<Result> => ipcRenderer.invoke('git:merge', branch),
  mergeCurrentInto: (targetBranch: string): Promise<Result & { autoStashed?: boolean }> =>
    ipcRenderer.invoke('git:merge-current-into', targetBranch),
  cherryPick: (sha: string): Promise<Result> => ipcRenderer.invoke('git:cherry-pick', sha),
  revert: (sha: string): Promise<Result> => ipcRenderer.invoke('git:revert', sha),
  reset: (sha: string, mode: 'soft' | 'mixed' | 'hard'): Promise<Result> =>
    ipcRenderer.invoke('git:reset', sha, mode),
  rebaseTo: (sha: string): Promise<Result> =>
    ipcRenderer.invoke('git:rebase-to', sha),
  rebaseContinue: (): Promise<Result> => ipcRenderer.invoke('git:rebase-continue'),
  rebaseAbort:    (): Promise<Result> => ipcRenderer.invoke('git:rebase-abort'),
  rebaseSkip:     (): Promise<Result> => ipcRenderer.invoke('git:rebase-skip'),
  mergeContinue:  (): Promise<Result> => ipcRenderer.invoke('git:merge-continue'),
  mergeAbort:     (): Promise<Result> => ipcRenderer.invoke('git:merge-abort'),
  markResolved:   (files: string[]): Promise<Result> => ipcRenderer.invoke('git:mark-resolved', files),
  getConflictFile: (filePath: string): Promise<ConflictFile> => ipcRenderer.invoke('git:conflict-file', filePath),
  writeFile:      (filePath: string, content: string): Promise<Result> => ipcRenderer.invoke('git:write-file', filePath, content),
  createTag: (name: string, sha: string): Promise<Result> =>
    ipcRenderer.invoke('git:create-tag', name, sha),
  runDragAction: (
    source: string,
    target: string,
    action: 'merge' | 'rebase' | 'checkout',
  ): Promise<Result & { autoStashed?: boolean }> =>
    ipcRenderer.invoke('git:run-drag-action', source, target, action),

  getWorktrees: (): Promise<WorktreeInfo[]> => ipcRenderer.invoke('git:worktrees'),
  addWorktree: (path: string, branch: string): Promise<Result> =>
    ipcRenderer.invoke('git:worktree-add', path, branch),
  removeWorktree: (path: string): Promise<Result> => ipcRenderer.invoke('git:worktree-remove', path),

  bisectStart: (): Promise<Result> => ipcRenderer.invoke('git:bisect-start'),
  bisectGood: (sha?: string): Promise<string> => ipcRenderer.invoke('git:bisect-good', sha),
  bisectBad: (sha?: string): Promise<string> => ipcRenderer.invoke('git:bisect-bad', sha),
  bisectReset: (): Promise<Result> => ipcRenderer.invoke('git:bisect-reset'),

  formatPatch: (sha: string): Promise<string> => ipcRenderer.invoke('git:format-patch', sha),
  applyPatch: (patchContent: string, opts?: { reverse?: boolean, cached?: boolean }): Promise<Result> =>
    ipcRenderer.invoke('git:apply-patch', patchContent, opts),

  getReflog: (limit?: number): Promise<CommitNode[]> => ipcRenderer.invoke('git:reflog', limit),

  onGitignoreChanged: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('git:gitignore-changed', handler)
    return () => { ipcRenderer.removeListener('git:gitignore-changed', handler) }
  },

  onRepoChanged: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('git:repo-changed', handler)
    return () => { ipcRenderer.removeListener('git:repo-changed', handler) }
  },

  getRecentProjects: (): Promise<string[]> => ipcRenderer.invoke('app:get-recent'),
  addRecentProject: (path: string): Promise<void> => ipcRenderer.invoke('app:add-recent', path),

  addRemote: (name: string, url: string): Promise<Result> => ipcRenderer.invoke('git:add-remote', name, url),
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
