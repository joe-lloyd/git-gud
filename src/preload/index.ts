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
  // Gerrit Change-Id trailer, when the commit message carries one.
  changeId?: string
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

// A ref namespace outside branches/tags/remotes/stash — e.g. T3 Chat's
// refs/t3/checkpoints/*. Mirrors main/git-service's OtherRefNamespace.
export type OtherRefNamespace = { namespace: string; count: number }

export type TagInfo = { name: string; sha: string }
export type StashInfo = { index: number; message: string; sha: string }

// Mirrors main/git-service: whole-file highlight sources, or why they were
// withheld (size cap / binary) so the viewer can tell the user.
export type DiffSources = {
  oldText: string
  newText: string
  skipped?: { reason: 'too-large' | 'binary'; sizeBytes: number; limitBytes: number }
}
// Mirrors main/git-service: a diff plus an optional untracked-file fallback
// notice. `truncated` previews can be re-requested with `fullUntracked: true`
// when `canLoadFull`.
export type FileDiffNotice = {
  reason: 'untracked-large' | 'untracked-binary'
  sizeBytes: number
  shownBytes: number
  truncated: boolean
  canLoadFull: boolean
}
export type FileDiffResult = { diff: string; notice?: FileDiffNotice }
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
  // True while a `git bisect` session is in progress (BISECT_LOG exists).
  inBisect: boolean
  // Set when core.hooksPath points at a missing directory — git silently
  // runs zero hooks then. Holds the configured value for display.
  hooksPathBroken?: string
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

// One persisted repo tab: `main` is the repository's main worktree path (tab
// identity), `worktree` the worktree that was active inside it.
export type SavedTab = { main: string; worktree: string }

export type Result = { success: true } | { success: false; error: string }

// Result of a command that writes the git index. `indexLocked` marks the one
// failure the GUI can fix on the user's behalf: a stale `.git/index.lock` from
// a crashed git process, cleared via `removeIndexLock()` and then retried.
export type IndexResult =
  | { success: true }
  | { success: false; error: string; indexLocked?: boolean }

// Save-to-disk outcome. `canceled` distinguishes a dismissed dialog from an
// actual write failure so the renderer can stay quiet instead of erroring.
export type SavePatchResult =
  | { success: true; path: string }
  | { success: false; error: string }
  | { canceled: true }

// Auto-update lifecycle. Emitted by the main process from electron-updater
// events. `downloaded` is the actionable state — renderer can prompt "Restart
// to install".
export type UpdateChannel = 'stable' | 'dev'
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
// `expected` marks probes whose failure was anticipated and handled (e.g. an
// untracked file has no index entry) — shown as a warning, not a failure.
export type GitActivity = {
  id: string
  repoPath: string
  args: string[]
  output: string
  failed: boolean
  kind: 'read' | 'write'
  expected?: boolean
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
export type PullErrorKind = 'dirty' | 'diverged' | 'untracked' | 'conflict' | 'auth' | 'not-ff' | 'unknown'
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

// Live progress for an in-flight clone, pushed on `git:clone-progress`.
export type CloneProgress = { phase: string; percent: number }
export type CloneResult =
  | { success: true; path: string }
  | { success: false; error: string }

const gitApi = {
  openDialog: (): Promise<string | null> => ipcRenderer.invoke('git:open-dialog'),
  openPath: (path: string): Promise<boolean> => ipcRenderer.invoke('git:open-path', path),

  // ── Clone ──────────────────────────────────────────────────────────────────
  // Pick the parent folder for a clone; null if the dialog was dismissed.
  cloneDialog: (): Promise<string | null> => ipcRenderer.invoke('git:clone-dialog'),
  defaultCloneDir: (): Promise<string> => ipcRenderer.invoke('app:default-clone-dir'),
  clone: (opts: { url: string; parentDir: string; name?: string }): Promise<CloneResult> =>
    ipcRenderer.invoke('git:clone', opts),
  onCloneProgress: (cb: (p: CloneProgress) => void) => {
    const handler = (_e: unknown, payload: CloneProgress) => cb(payload)
    ipcRenderer.on('git:clone-progress', handler)
    return () => { ipcRenderer.removeListener('git:clone-progress', handler) }
  },
  addTab: (path: string): Promise<boolean> => ipcRenderer.invoke('git:add-tab', path),
  activatePath: (path: string): Promise<boolean> => ipcRenderer.invoke('git:activate-path', path),
  // extraPaths: other worktree paths this tab activated (their cached
  // services in main are dropped together with the tab).
  closeTab: (path: string, extraPaths?: string[]): Promise<boolean> =>
    ipcRenderer.invoke('git:close-tab', path, extraPaths ?? []),
  getActivePath: (): Promise<string | null> => ipcRenderer.invoke('git:active-path'),
  getOpenTabs: (): Promise<string[]> => ipcRenderer.invoke('git:open-tabs'),
  // One tab per repository: main worktree path (identity) + active worktree.
  getSavedTabs: (): Promise<{ tabs: SavedTab[]; active: string | null }> =>
    ipcRenderer.invoke('app:get-saved-tabs'),
  saveTabs: (payload: { tabs: SavedTab[]; active: string | null }): Promise<boolean> =>
    ipcRenderer.invoke('app:save-tabs', payload),

  // includeOtherRefs adds tool-private namespaces (refs/t3/*, refs/notes, …)
  // to the walk; off by default so the graph shows only real branches/tags.
  getLog: (limit?: number, opts?: { includeOtherRefs?: boolean; includeGerritPatchsets?: boolean }): Promise<CommitNode[]> =>
    ipcRenderer.invoke('git:log', limit, opts ?? {}),
  getOtherRefNamespaces: (): Promise<OtherRefNamespace[]> =>
    ipcRenderer.invoke('git:other-ref-namespaces'),
  getBranches: (): Promise<BranchData> => ipcRenderer.invoke('git:branches'),
  getTags: (): Promise<TagInfo[]> => ipcRenderer.invoke('git:tags'),
  getStashes: (): Promise<StashInfo[]> => ipcRenderer.invoke('git:stashes'),
  getStatus: (): Promise<RepoStatus | null> => ipcRenderer.invoke('git:status'),
  getRemotes: (): Promise<RemoteInfo[]> => ipcRenderer.invoke('git:remotes'),

  getCommitDiff: (sha: string): Promise<string> => ipcRenderer.invoke('git:commit-diff', sha),
  getCommitFiles: (sha: string): Promise<FileChange[]> => ipcRenderer.invoke('git:commit-files', sha),
  getFileDiff: (filePath: string, staged: boolean, opts?: { wordDiff?: boolean; ignoreWhitespace?: boolean; fullUntracked?: boolean }): Promise<FileDiffResult> =>
    ipcRenderer.invoke('git:file-diff', filePath, staged, opts),
  getCommitFileDiff: (sha: string, filePath: string, opts?: { wordDiff?: boolean; ignoreWhitespace?: boolean }): Promise<string> =>
    ipcRenderer.invoke('git:commit-file-diff', sha, filePath, opts),
  // Full old/new file contents behind a diff — lets the viewer highlight
  // complete files so multi-line tokens (block comments) render correctly.
  // `skipped` set (with empty texts) when the file is too large or binary.
  getFileDiffSources: (filePath: string, staged: boolean): Promise<DiffSources> =>
    ipcRenderer.invoke('git:file-diff-sources', filePath, staged),
  getCommitFileDiffSources: (sha: string, filePath: string): Promise<DiffSources> =>
    ipcRenderer.invoke('git:commit-file-diff-sources', sha, filePath),


  checkout: (branch: string): Promise<{ success: boolean; error?: string; kind?: PullErrorKind }> =>
    ipcRenderer.invoke('git:checkout', branch),
  checkoutAutostash: (branch: string): Promise<Result & { stashMessage?: string }> =>
    ipcRenderer.invoke('git:checkout-autostash', branch),

  // `indexLocked` is set when the failure was a stale `.git/index.lock`, which
  // the UI can clear with removeIndexLock() and then retry.
  stage: (files: string[]): Promise<IndexResult> => ipcRenderer.invoke('git:stage', files),
  unstage: (files: string[]): Promise<IndexResult> => ipcRenderer.invoke('git:unstage', files),
  removeIndexLock: (): Promise<Result & { path?: string }> =>
    ipcRenderer.invoke('git:remove-index-lock'),
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
  pull: (opts?: { rebase?: boolean; autoStash?: boolean; ffOnly?: boolean }): Promise<PullResult> =>
    ipcRenderer.invoke('git:pull', opts),
  // Fast-forward a branch that is NOT checked out from its remote, without
  // touching the working tree (git fetch <remote> <branch>:<branch>).
  fastForwardBranch: (branchName: string): Promise<PullResult> =>
    ipcRenderer.invoke('git:fast-forward-branch', branchName),
  push: (force?: boolean): Promise<Result> => ipcRenderer.invoke('git:push', force),

  createBranch: (name: string, startPoint?: string): Promise<Result> =>
    ipcRenderer.invoke('git:create-branch', name, startPoint),
  deleteBranch: (name: string, force?: boolean): Promise<Result> =>
    ipcRenderer.invoke('git:delete-branch', name, force),
  renameBranch: (oldName: string, newName: string): Promise<Result> =>
    ipcRenderer.invoke('git:rename-branch', oldName, newName),
  // alreadyGone: the remote had no such branch, so a stale local tracking ref
  // was pruned instead of a real remote delete.
  deleteRemoteBranch: (remote: string, branch: string): Promise<Result & { alreadyGone?: boolean }> =>
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
  deleteTag: (name: string): Promise<Result> =>
    ipcRenderer.invoke('git:delete-tag', name),
  renameTag: (oldName: string, newName: string): Promise<Result> =>
    ipcRenderer.invoke('git:rename-tag', oldName, newName),
  pushTag: (remote: string, name: string): Promise<Result> =>
    ipcRenderer.invoke('git:push-tag', remote, name),
  // alreadyGone: the remote had no such tag. The local tag is left alone.
  deleteRemoteTag: (remote: string, name: string): Promise<Result & { alreadyGone?: boolean }> =>
    ipcRenderer.invoke('git:delete-remote-tag', remote, name),
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
  applyPatch: (patchContent: string, opts?: { reverse?: boolean, cached?: boolean, ignoreWhitespace?: boolean }): Promise<Result> =>
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
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  updaterCheck: (): Promise<{ success: boolean; version?: string; error?: string }> =>
    ipcRenderer.invoke('updater:check'),
  updaterInstall: (): Promise<void> => ipcRenderer.invoke('updater:install'),
  // Which GitHub releases the updater follows: stable only, or dev
  // pre-releases too. Setting it persists the choice and re-checks at once.
  getUpdateChannel: (): Promise<UpdateChannel> => ipcRenderer.invoke('updater:get-channel'),
  setUpdateChannel: (channel: UpdateChannel): Promise<{ success: boolean; version?: string; error?: string }> =>
    ipcRenderer.invoke('updater:set-channel', channel),
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

// ── Gerrit ─────────────────────────────────────────────────────────────────
// Additive Gerrit mode: detection is read-only, the mode flag itself lives in
// repo-local git config (gitgud.gerrit.*) via gitApi.getConfig/setConfig.

// Outcome of the detection heuristics for the active repo. `likely` means at
// least one signal matched; host/project/defaultBranch are best-effort values
// harvested from .gitreview or the remote URL to pre-fill the enable flow.
export type GerritDetection = {
  likely: boolean
  signals: string[]
  remote?: string
  host?: string
  project?: string
  defaultBranch?: string
}

export type PushForReviewOptions = {
  remote: string
  targetBranch: string
  topic?: string
  wip?: boolean
  ready?: boolean
  private?: boolean
}

// `kind` classifies Gerrit's well-known push rejections so the UI can react
// with a targeted message instead of the generic failure toast.
export type PushForReviewResult =
  | { success: true }
  | { success: false; error: string; kind: 'missing-change-id' | 'no-new-changes' | 'unknown' }

// One patchset (amendment) of a change, newest first in GerritChange.
export type GerritPatchset = {
  sha: string
  number: number
  created: string
  kind: string
  // Server ref (refs/changes/<nn>/<n>/<ps>); fetched in "all patch sets" mode.
  ref?: string
}

// What syncChangeRefs mirrors per open change. `patchsets` lists every
// patchset; older ones land in refs/gitgud/patchsets/<n>/<ps>.
export type ChangeRefSyncEntry = {
  number: number
  currentRef?: string
  patchsets?: Array<{ number: number; ref?: string }>
}

export type GerritChange = {
  id: string // Change-Id
  number: number
  subject: string
  owner: string
  branch: string
  patchset: number
  wip: boolean
  updated: string
  url: string
  // Current patchset commit + its server ref — used to fetch the change
  // into refs/gitgud/changes/<number> so the graph renders it as a node.
  currentSha?: string
  currentRef?: string
  // Full amendment history (all patchsets), newest first.
  patchsets: GerritPatchset[]
}

// `auth` reports which credential source the fetch used: explicitly stored
// credentials, git's own cookie file (http.cookiefile — same auth as
// push/pull on googlesource-style hosts), or none.
export type GerritAuthMode = 'stored' | 'gitcookies' | 'anonymous'
export type GerritChangesResult =
  | { success: true; changes: GerritChange[]; auth: GerritAuthMode }
  | { success: false; error: string }

export type CommitTrailer = { key: string; value: string }

const gerritApi = {
  detect: (): Promise<GerritDetection> => ipcRenderer.invoke('gerrit:detect'),
  pushForReview: (opts: PushForReviewOptions): Promise<PushForReviewResult> =>
    ipcRenderer.invoke('gerrit:push-for-review', opts),
  listChanges: (host: string, project: string): Promise<GerritChangesResult> =>
    ipcRenderer.invoke('gerrit:list-changes', host, project),
  // Fetch open changes' patchsets into refs/gitgud/changes/* (graph nodes)
  // and prune the ones no longer open.
  syncChangeRefs: (remote: string, changes: ChangeRefSyncEntry[]): Promise<{ success: boolean; error?: string; fetched: number; pruned: number }> =>
    ipcRenderer.invoke('gerrit:sync-change-refs', remote, changes),
  clearChangeRefs: (): Promise<number> => ipcRenderer.invoke('gerrit:clear-change-refs'),
  // Credentials never come back to the renderer — only a boolean status.
  setAuth: (host: string, username: string, password: string): Promise<Result> =>
    ipcRenderer.invoke('gerrit:set-auth', host, username, password),
  clearAuth: (host: string): Promise<boolean> => ipcRenderer.invoke('gerrit:clear-auth', host),
  authStatus: (host: string): Promise<boolean> => ipcRenderer.invoke('gerrit:auth-status', host),
}

// UI/chrome controls that live in the renderer process (not git). Text scaling
// uses webFrame's native page zoom so every px-based size scales uniformly and
// layout math (drag handles etc.) stays consistent.
const uiApi = {
  setZoomFactor: (factor: number): void => { webFrame.setZoomFactor(factor) },
  getZoomFactor: (): number => webFrame.getZoomFactor(),
  // Open an http(s) URL in the system browser (main validates the scheme).
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('app:open-external', url),
  // Reveal a folder in the OS file manager (Explorer/Finder).
  showInFolder: (path: string): Promise<boolean> => ipcRenderer.invoke('app:show-in-folder', path),
}

// ── Peers ──────────────────────────────────────────────────────────────────
// Other Git Gud instances on the LAN, over TLS with certificates pinned at
// pairing. Sharing (host side) is opt-in; a paired
// peer's repos open as normal tabs whose path is gitgud-peer://<peerId>/<path>
// and whose reads + sync ops run on that machine. Tokens never reach the
// renderer — only status.

export type PeerStatus = 'connected' | 'connecting' | 'offline' | 'revoked' | 'cert-changed'
export type TransportKind = 'lan' | 'tailnet' | 'tunnel' | 'wan' | 'relay'
export type PeerInfo = { peerId: string; name: string; version: string; platform: string; protocol: number; fingerprint: string }
export type PeerRepoSummary = { path: string; name: string; open: boolean }
export type PeerState = {
  self: { peerId: string; name: string }
  server: {
    enabled: boolean
    running: boolean
    port: number
    readOnly: boolean
    push: boolean
    relay: { url: string; status: string; error: string }
    pairingCode: string
    /** SHA-256 fingerprint of this host's TLS certificate (AA:BB:…). */
    fingerprint: string
    error: string
    paired: Array<{ peerId: string; name: string; createdAt: number; connected: boolean; readOnly: boolean; kind: string; scopes: string[] }>
  }
  discovered: Array<{ peerId: string; name: string; address: string; port: number; version: string; known: boolean }>
  peers: Array<{ peerId: string; name: string; host: string; port: number; status: PeerStatus; error: string; rttMs: number | null; transport: TransportKind; platform: string; hostReadOnly: boolean; tokenExpiresAt: number | null ; relay: string | null }>
}

const peerApi = {
  getState: (): Promise<PeerState | null> => ipcRenderer.invoke('peer:get-state'),
  onState: (cb: (s: PeerState) => void) => {
    const handler = (_e: unknown, s: PeerState) => cb(s)
    ipcRenderer.on('peer:state', handler)
    return () => { ipcRenderer.removeListener('peer:state', handler) }
  },
  // Host side
  setServer: (patch: { enabled?: boolean; port?: number; name?: string; readOnly?: boolean; push?: boolean; relayUrl?: string }): Promise<PeerState | null> =>
    ipcRenderer.invoke('peer:set-server', patch),
  regenerateCode: (): Promise<string> => ipcRenderer.invoke('peer:regenerate-code'),
  pairingQr: (): Promise<{ payload: string; svg: string; error?: string } | null> => ipcRenderer.invoke('peer:pairing-qr'),
  pairPayload: (text: string): Promise<{ success: boolean; peerId?: string; name?: string; error?: string }> => ipcRenderer.invoke('peer:pair-payload', text),
  revokeDevice: (peerId: string): Promise<boolean> => ipcRenderer.invoke('peer:revoke-device', peerId),
  setDeviceReadOnly: (peerId: string, readOnly: boolean): Promise<boolean> => ipcRenderer.invoke('peer:set-device-read-only', peerId, readOnly),
  setDeviceScopes: (peerId: string, scopes: string[]): Promise<boolean> => ipcRenderer.invoke('peer:set-device-scopes', peerId, scopes),
  // Client side
  probe: (host: string, port: number): Promise<{ success: boolean; info?: PeerInfo; error?: string }> =>
    ipcRenderer.invoke('peer:probe', host, port),
  pair: (host: string, port: number, code: string): Promise<{ success: boolean; peer?: { peerId: string; name: string }; error?: string }> =>
    ipcRenderer.invoke('peer:pair', host, port, code),
  connect: (peerId: string): Promise<boolean> => ipcRenderer.invoke('peer:connect', peerId),
  disconnect: (peerId: string): Promise<boolean> => ipcRenderer.invoke('peer:disconnect', peerId),
  // Returns the tab paths that belonged to the forgotten peer (close them).
  forget: (peerId: string): Promise<string[]> => ipcRenderer.invoke('peer:forget', peerId),
  listRepos: (peerId: string): Promise<{ success: boolean; repos?: PeerRepoSummary[]; error?: string }> =>
    ipcRenderer.invoke('peer:list-repos', peerId),
  repoPath: (peerId: string, remotePath: string): Promise<string> => ipcRenderer.invoke('peer:repo-path', peerId, remotePath),
  statusFor: (peerRepoPath: string): Promise<{ name: string; status: PeerStatus; error: string } | null> =>
    ipcRenderer.invoke('peer:status-for', peerRepoPath),
}

contextBridge.exposeInMainWorld('gitApi', gitApi)
contextBridge.exposeInMainWorld('peerApi', peerApi)
contextBridge.exposeInMainWorld('githubApi', githubApi)
contextBridge.exposeInMainWorld('providerApi', providerApi)
contextBridge.exposeInMainWorld('gerritApi', gerritApi)
contextBridge.exposeInMainWorld('uiApi', uiApi)

// Type helper for renderer
export type GitApi = typeof gitApi
export type GitHubApi = typeof githubApi
export type ProviderApi = typeof providerApi
export type GerritApi = typeof gerritApi
export type UiApi = typeof uiApi
export type PeerApi = typeof peerApi
