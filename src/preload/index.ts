import { contextBridge, ipcRenderer, webFrame } from 'electron'

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

// Save-to-disk outcome. `canceled` distinguishes a dismissed dialog from an
// actual write failure so the renderer can stay quiet instead of erroring.
export type SavePatchResult =
  | { success: true; path: string }
  | { success: false; error: string }
  | { canceled: true }

// Auto-update lifecycle. Emitted by the main process from electron-updater
// events. `downloaded` is the actionable state — renderer can prompt "Restart
// to install".
export type UpdaterStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'none' }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; error: string }
export type CommitOpts = {
  subject: string
  body?: string
  noVerify?: boolean
  signoff?: boolean
  // Correlates the streamed commit/hook output with this invocation so a stale
  // stream from a previous commit can't bleed into the active one.
  runId?: string
}

// Commit result — additive superset of `Result`. `output` is the full captured
// stdout+stderr (incl. hook output); `hooksRan` is false when --no-verify.
export type CommitResult = {
  success: boolean
  error?: string
  output?: string
  exitCode?: number | null
  hooksRan?: boolean
}

// One git command + its response, pushed on `git:activity` for the git console.
// `kind` distinguishes routine read-only polling from actual mutations.
export type GitActivity = {
  id: string
  repoPath: string
  args: string[]
  output: string
  failed: boolean
  kind: 'read' | 'write'
  exitCode?: number | null
  durationMs: number
  ts: number
}

// Command-console output, pushed on `console:output` keyed by runId.
export type ConsoleOutputEvent =
  | { runId: string; stream: 'stdout' | 'stderr'; chunk: string; done?: false }
  | { runId: string; done: true; exitCode: number | null }
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


  checkout: (branch: string): Promise<{ success: boolean; error?: string; kind?: PullErrorKind }> =>
    ipcRenderer.invoke('git:checkout', branch),
  checkoutAutostash: (branch: string): Promise<Result & { stashMessage?: string }> =>
    ipcRenderer.invoke('git:checkout-autostash', branch),

  stage: (files: string[]): Promise<Result> => ipcRenderer.invoke('git:stage', files),
  unstage: (files: string[]): Promise<Result> => ipcRenderer.invoke('git:unstage', files),
  discardChanges: (files: string[], opts: { staged: boolean }): Promise<Result> =>
    ipcRenderer.invoke('git:discard-changes', files, opts),
  discardUntracked: (files: string[]): Promise<Result> =>
    ipcRenderer.invoke('git:discard-untracked', files),
  commit: (opts: CommitOpts): Promise<CommitResult> =>
    ipcRenderer.invoke('git:commit', opts),
  commitAmend: (opts: CommitOpts & { author?: string }): Promise<CommitResult> =>
    ipcRenderer.invoke('git:commit-amend', opts),
  // ── Console dock ──────────────────────────────────────────────────────────
  // Live feed of every git command + response (the right console).
  onGitActivity: (cb: (e: GitActivity) => void) => {
    const handler = (_e: unknown, payload: GitActivity) => cb(payload)
    ipcRenderer.on('git:activity', handler)
    return () => { ipcRenderer.removeListener('git:activity', handler) }
  },
  // The active worktree root (command-console cwd / prompt).
  getRepoRoot: (): Promise<string | null> => ipcRenderer.invoke('console:cwd'),
  // Run a non-interactive command at the worktree root; output streams on
  // `console:output` keyed by runId. Resolves with the exit code.
  runConsoleCommand: (runId: string, cmd: string): Promise<{ success: boolean; exitCode?: number | null; error?: string }> =>
    ipcRenderer.invoke('console:run', runId, cmd),
  cancelConsoleCommand: (runId: string): Promise<boolean> => ipcRenderer.invoke('console:cancel', runId),
  onConsoleOutput: (cb: (e: ConsoleOutputEvent) => void) => {
    const handler = (_e: unknown, payload: ConsoleOutputEvent) => cb(payload)
    ipcRenderer.on('console:output', handler)
    return () => { ipcRenderer.removeListener('console:output', handler) }
  },
  setHeadAuthor: (author: string): Promise<Result> =>
    ipcRenderer.invoke('git:set-head-author', author),
  getHeadAuthor: (): Promise<string> => ipcRenderer.invoke('git:head-author'),
  getCommitMessage: (sha?: string): Promise<string> => ipcRenderer.invoke('git:commit-message', sha),
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

  // ── Multi-commit bulk ops (selection in the graph) ───────────────────────
  // Squash/drop operate on a contiguous range and may leave the repo mid-rebase
  // (conflict: true) so the conflict UI can take over. cherry-pick/revert-many
  // apply a set of commits in the safe order.
  squashCommits: (shas: string[], message: string): Promise<Result & { conflict?: boolean }> =>
    ipcRenderer.invoke('git:squash-commits', shas, message),
  dropCommits: (shas: string[]): Promise<Result & { conflict?: boolean }> =>
    ipcRenderer.invoke('git:drop-commits', shas),
  cherryPickMany: (shas: string[]): Promise<Result> =>
    ipcRenderer.invoke('git:cherry-pick-many', shas),
  revertMany: (shas: string[]): Promise<Result> =>
    ipcRenderer.invoke('git:revert-many', shas),
  rangeStat: (oldestSha: string, newestSha: string): Promise<{ files: number; insertions: number; deletions: number } | null> =>
    ipcRenderer.invoke('git:range-stat', oldestSha, newestSha),

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
  removeWorktree: (path: string, force?: boolean): Promise<Result> => ipcRenderer.invoke('git:worktree-remove', path, force),

  bisectStart: (): Promise<Result> => ipcRenderer.invoke('git:bisect-start'),
  bisectGood: (sha?: string): Promise<string> => ipcRenderer.invoke('git:bisect-good', sha),
  bisectBad: (sha?: string): Promise<string> => ipcRenderer.invoke('git:bisect-bad', sha),
  bisectReset: (): Promise<Result> => ipcRenderer.invoke('git:bisect-reset'),

  formatPatch: (sha: string): Promise<string> => ipcRenderer.invoke('git:format-patch', sha),
  applyPatch: (patchContent: string, opts?: { reverse?: boolean, cached?: boolean }): Promise<Result> =>
    ipcRenderer.invoke('git:apply-patch', patchContent, opts),
  buildWorkingPatch: (tracked: string[], untracked: string[]): Promise<string> =>
    ipcRenderer.invoke('git:working-patch', tracked, untracked),
  savePatch: (content: string, defaultName: string): Promise<SavePatchResult> =>
    ipcRenderer.invoke('patch:save', content, defaultName),

  getReflog: (limit?: number): Promise<CommitNode[]> => ipcRenderer.invoke('git:reflog', limit),
  restoreFromReflog: (sha: string): Promise<Result> => ipcRenderer.invoke('git:reflog-restore', sha),

  cleanPreview: (opts: { dirs: boolean; ignored: boolean }): Promise<string[]> =>
    ipcRenderer.invoke('git:clean-preview', opts),
  clean: (paths: string[], opts: { dirs: boolean; ignored: boolean }): Promise<Result> =>
    ipcRenderer.invoke('git:clean', paths, opts),

  getConfig: (key: string): Promise<string> => ipcRenderer.invoke('git:config-get', key),
  setConfig: (key: string, value: string): Promise<Result> => ipcRenderer.invoke('git:config-set', key, value),
  rerereStatus: (): Promise<string[]> => ipcRenderer.invoke('git:rerere-status'),
  rerereForget: (path: string): Promise<Result> => ipcRenderer.invoke('git:rerere-forget', path),

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

  // ── Auto-updater ─────────────────────────────────────────────────────
  updaterCheck: (): Promise<{ success: boolean; version?: string; error?: string }> =>
    ipcRenderer.invoke('updater:check'),
  updaterInstall: (): Promise<void> => ipcRenderer.invoke('updater:install'),
  onUpdaterStatus: (cb: (s: UpdaterStatus) => void) => {
    const handler = (_e: unknown, s: UpdaterStatus) => cb(s)
    ipcRenderer.on('updater:status', handler)
    return () => { ipcRenderer.removeListener('updater:status', handler) }
  },
  onUpdaterProgress: (cb: (p: { percent: number }) => void) => {
    const handler = (_e: unknown, p: { percent: number }) => cb(p)
    ipcRenderer.on('updater:progress', handler)
    return () => { ipcRenderer.removeListener('updater:progress', handler) }
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

// ── GitLab / Bitbucket ─────────────────────────────────────────────────────
// Token-based sign-in (GitLab PAT / Bitbucket app password). Same user/repo
// shapes as the GitHub API above so panels can share components.
export type HostedProvider = 'gitlab' | 'bitbucket'

const providerApi = {
  signInGitLab: (host: string, token: string): Promise<{ success: boolean; user?: GitHubUser; error?: string }> =>
    ipcRenderer.invoke('provider:signin-gitlab', host, token),
  signInBitbucket: (username: string, token: string): Promise<{ success: boolean; user?: GitHubUser; error?: string }> =>
    ipcRenderer.invoke('provider:signin-bitbucket', username, token),
  signOut: (provider: HostedProvider): Promise<boolean> => ipcRenderer.invoke('provider:signout', provider),
  getUser: (provider: HostedProvider): Promise<GitHubUser | null> => ipcRenderer.invoke('provider:get-user', provider),
  createRepo: (provider: HostedProvider, name: string, description: string, isPrivate: boolean): Promise<{ success: boolean; repo?: GitHubRepo; error?: string }> =>
    ipcRenderer.invoke('provider:create-repo', provider, name, description, isPrivate),
  listRepos: (provider: HostedProvider): Promise<{ success: boolean; repos?: GitHubRepo[]; error?: string }> =>
    ipcRenderer.invoke('provider:list-repos', provider),
}

// UI/chrome controls that live in the renderer process (not git). Text scaling
// uses webFrame's native page zoom so every px-based size scales uniformly and
// layout math (drag handles etc.) stays consistent.
const uiApi = {
  setZoomFactor: (factor: number): void => { webFrame.setZoomFactor(factor) },
  getZoomFactor: (): number => webFrame.getZoomFactor(),
  // Open an http(s) URL in the system browser (main validates the scheme).
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('app:open-external', url),
}

contextBridge.exposeInMainWorld('gitApi', gitApi)
contextBridge.exposeInMainWorld('githubApi', githubApi)
contextBridge.exposeInMainWorld('providerApi', providerApi)
contextBridge.exposeInMainWorld('uiApi', uiApi)

// Type helper for renderer
export type GitApi = typeof gitApi
export type GitHubApi = typeof githubApi
export type ProviderApi = typeof providerApi
export type UiApi = typeof uiApi
