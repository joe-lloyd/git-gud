import { app, BrowserWindow, ipcMain, dialog, nativeImage } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import * as fs from 'fs'
import { GitService } from './git-service'
import { GitHubService } from './github-service'

// App icon — resources/icon.png is rasterized from icon.svg by scripts/render-icon.cjs.
// In dev `__dirname` is out/main, in prod it's inside the bundle; both sit one
// level under the project root, so ../../resources resolves either way.
const ICON_PATH = join(__dirname, '..', '..', 'resources', 'icon.png')

let mainWindow: BrowserWindow | null = null
// All loaded repos — one GitService per open tab.
const services = new Map<string, GitService>()
// The active service is what every IPC handler reads/writes against.
// Renderer flips this via `git:activate-path` when switching tabs.
let gitService: GitService | null = null
let activeRepoPath: string | null = null
let githubService: GitHubService | null = null
let repoWatchers: fs.FSWatcher[] = []
let repoChangeTimer: NodeJS.Timeout | null = null

function stopRepoWatchers() {
  for (const w of repoWatchers) {
    try { w.close() } catch { /* ignore */ }
  }
  repoWatchers = []
  if (repoChangeTimer) { clearTimeout(repoChangeTimer); repoChangeTimer = null }
}

// Activate (or create) the GitService for a repo path. Flips the watcher to
// follow this path. Used by tab-switching and by initial open.
function activateRepo(repoPath: string): GitService {
  let svc = services.get(repoPath)
  if (!svc) {
    svc = new GitService(repoPath, () => githubService?.getToken() || null)
    services.set(repoPath, svc)
  }
  gitService = svc
  activeRepoPath = repoPath
  startRepoWatchers(repoPath)
  return svc
}

function startRepoWatchers(repoPath: string) {
  stopRepoWatchers()

  // Coalesce bursts (e.g. checkout fires many ref writes) and ignore events that
  // arrive while a refresh is in flight — those are echoes of our own reads.
  // (`git status` reads can touch .git/index even though we don't watch it; the
  // ref dir gets bumped on `git log --all` packed-refs reads on some setups.)
  let busyUntil = 0
  const emit = () => {
    if (Date.now() < busyUntil) return
    if (repoChangeTimer) clearTimeout(repoChangeTimer)
    repoChangeTimer = setTimeout(() => {
      repoChangeTimer = null
      busyUntil = Date.now() + 1500  // suppress echoes from the refresh that follows
      mainWindow?.webContents.send('git:repo-changed')
    }, 500)
  }

  // 1) Repo root — .gitignore changes (kept for back-compat)
  try {
    repoWatchers.push(
      fs.watch(repoPath, { persistent: false }, (_evt, filename) => {
        if (filename && filename.endsWith('.gitignore')) {
          mainWindow?.webContents.send('git:gitignore-changed')
        }
      }),
    )
  } catch { /* repo root unwatchable — ignore */ }

  // 2) .git internals — only HEAD + refs/ + packed-refs.
  // Do NOT watch .git/index or .git/logs — both are touched by read-only ops
  // (status, log) and would cause infinite refresh loops.
  // External commits move HEAD, so they're still caught.
  const gitDir = join(repoPath, '.git')
  const watchTargets = [
    join(gitDir, 'HEAD'),
    join(gitDir, 'refs'),
    join(gitDir, 'packed-refs'),
  ]
  for (const target of watchTargets) {
    try {
      if (!fs.existsSync(target)) continue
      const isDir = fs.statSync(target).isDirectory()
      repoWatchers.push(
        fs.watch(target, { persistent: false, recursive: isDir }, () => {
          emit()
        }),
      )
    } catch { /* macOS rename or transient — fall back to focus-refresh */ }
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    icon: ICON_PATH,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── Auto-updater ────────────────────────────────────────────────────────
// Checks GitHub Releases for a newer version, downloads in the background,
// then asks the user to restart for the swap. No-op in dev (the dev binary
// isn't packaged so the updater would just fail).
function setupAutoUpdater(): void {
  if (process.env['ELECTRON_RENDERER_URL']) return  // dev mode
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const send = (channel: string, payload?: unknown) => {
    mainWindow?.webContents.send(channel, payload)
  }

  autoUpdater.on('checking-for-update', () => send('updater:status', { state: 'checking' }))
  autoUpdater.on('update-available', (info) => send('updater:status', { state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => send('updater:status', { state: 'none' }))
  autoUpdater.on('error', (err) => send('updater:status', { state: 'error', error: String(err) }))
  autoUpdater.on('download-progress', (p) => send('updater:progress', { percent: p.percent }))
  autoUpdater.on('update-downloaded', (info) => send('updater:status', { state: 'downloaded', version: info.version }))

  // First check happens shortly after launch (give the renderer time to
  // subscribe). After that the updater polls every 4 hours on its own.
  setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}) }, 5_000)

  // Renderer can also trigger a manual check (via toolbar / settings).
  ipcMain.handle('updater:check', async () => {
    try { const r = await autoUpdater.checkForUpdates(); return { success: true, version: r?.updateInfo.version } }
    catch (e) { return { success: false, error: String(e) } }
  })
  ipcMain.handle('updater:install', () => {
    // Closes the app and restarts on the new version.
    autoUpdater.quitAndInstall()
  })
}

app.whenReady().then(() => {
  // macOS dock icon — BrowserWindow.icon doesn't change the dock at runtime
  // on Darwin; app.dock.setIcon does. Silently skipped on other platforms.
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(nativeImage.createFromPath(ICON_PATH)) } catch { /* ignore */ }
  }

  githubService = new GitHubService()
  createWindow()

  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // ── Repository ──────────────────────────────────────────────────────
  ipcMain.handle('git:open-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Open Git Repository'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const repoPath = result.filePaths[0]
    const candidate = new GitService(repoPath, () => githubService?.getToken() || null)
    const isRepo = await candidate.isRepo()
    if (!isRepo) {
      const { response } = await dialog.showMessageBox(mainWindow!, {
        type: 'question',
        title: 'Not a Git repository',
        message: `"${repoPath.split('/').pop()}" is not a Git repository.`,
        detail: 'Would you like to initialize Git here?',
        buttons: ['Initialize Git', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      })
      if (response === 1) return null
      try {
        await candidate['git'].init()
      } catch (e) {
        await dialog.showMessageBox(mainWindow!, {
          type: 'error',
          title: 'Git init failed',
          message: String(e),
        })
        return null
      }
    }
    services.set(repoPath, candidate)
    activateRepo(repoPath)
    saveTabState()
    return repoPath
  })

  ipcMain.handle('git:open-path', async (_event, repoPath: string) => {
    try {
      // Already loaded? Just re-activate.
      if (services.has(repoPath)) {
        activateRepo(repoPath)
        saveTabState()
        return true
      }
      const candidate = new GitService(repoPath, () => githubService?.getToken() || null)
      const isRepo = await candidate.isRepo()
      if (!isRepo) return false
      services.set(repoPath, candidate)
      activateRepo(repoPath)
      saveTabState()
      return true
    } catch { return false }
  })

  // Flip the active tab. Returns false if the path isn't loaded yet.
  ipcMain.handle('git:activate-path', async (_event, repoPath: string) => {
    if (!services.has(repoPath)) return false
    activateRepo(repoPath)
    saveTabState()
    return true
  })

  // Close a tab — drop the service, stop the watcher if it was active.
  ipcMain.handle('git:close-tab', async (_event, repoPath: string) => {
    services.delete(repoPath)
    if (activeRepoPath === repoPath) {
      stopRepoWatchers()
      gitService = null
      activeRepoPath = null
    }
    saveTabState()
    return true
  })

  ipcMain.handle('git:active-path', async () => activeRepoPath)
  ipcMain.handle('git:open-tabs', async () => Array.from(services.keys()))

  // ── Session: persisted tabs ─────────────────────────────────────────────────
  // We persist the list of open tabs (and the active one) so a relaunch restores
  // the workspace the user had open. Writes happen after every mutation that
  // affects either list — open, activate, close. Reads happen once on renderer
  // mount via `app:get-saved-tabs`.

  const tabsFile = join(app.getPath('userData'), 'open-tabs.json')

  function getSavedTabs(): { tabs: string[]; active: string | null } {
    try {
      if (fs.existsSync(tabsFile)) {
        const parsed = JSON.parse(fs.readFileSync(tabsFile, 'utf8'))
        const tabs = Array.isArray(parsed?.tabs) ? parsed.tabs.filter((p: unknown): p is string => typeof p === 'string') : []
        const active = typeof parsed?.active === 'string' ? parsed.active : null
        return { tabs, active }
      }
    } catch (e) {
      console.error('Failed to read saved tabs', e)
    }
    return { tabs: [], active: null }
  }

  function saveTabState() {
    try {
      const tabs = Array.from(services.keys())
      const active = activeRepoPath
      fs.writeFileSync(tabsFile, JSON.stringify({ tabs, active }, null, 2))
    } catch (e) {
      console.error('Failed to save tabs', e)
    }
  }

  // Open a tab WITHOUT making it active — used at startup to restore a session
  // of N tabs and only activate one at the end. Returns false if the path is
  // no longer a valid repo (silently dropped from the restored list).
  ipcMain.handle('git:add-tab', async (_event, repoPath: string) => {
    try {
      if (services.has(repoPath)) return true
      const candidate = new GitService(repoPath, () => githubService?.getToken() || null)
      const isRepo = await candidate.isRepo()
      if (!isRepo) return false
      services.set(repoPath, candidate)
      saveTabState()
      return true
    } catch { return false }
  })

  ipcMain.handle('app:get-saved-tabs', async () => getSavedTabs())

  // ── Settings / Recent Projects ───────────────────────────────────────────────

  const recentProjectsFile = join(app.getPath('userData'), 'recent-projects.json')

  function getRecentProjects(): string[] {
    try {
      if (fs.existsSync(recentProjectsFile)) {
        const data = fs.readFileSync(recentProjectsFile, 'utf8')
        const parsed = JSON.parse(data)
        if (Array.isArray(parsed)) return parsed
      }
    } catch (e) {
      console.error('Failed to read recent projects', e)
    }
    return []
  }

  function addRecentProject(path: string) {
    try {
      let recent = getRecentProjects()
      recent = recent.filter(p => p !== path) // Remove if exists
      recent.unshift(path) // Push to front
      recent = recent.slice(0, 10) // Keep at most 10
      fs.writeFileSync(recentProjectsFile, JSON.stringify(recent, null, 2))
    } catch (e) {
      console.error('Failed to save recent projects', e)
    }
  }

  ipcMain.handle('app:get-recent', async () => getRecentProjects())
  ipcMain.handle('app:add-recent', async (_event, path: string) => addRecentProject(path))

  // ── GitHub Integration ────────────────────────────────────────────────────────
  ipcMain.handle('github:start-device-flow', async (_event, clientId: string) => {
    if (!githubService) return { success: false, error: 'GitHub service not ready' }
    try {
      const flow = await githubService.startDeviceFlow(clientId)
      return { success: true, flow }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('github:poll-token', async (_event, clientId: string, deviceCode: string) => {
    if (!githubService) return { success: false, error: 'GitHub service not ready' }
    try {
      const user = await githubService.pollForToken(clientId, deviceCode)
      return { success: true, user }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('github:logout', async () => {
    if (githubService) githubService.clearToken()
    return true
  })

  ipcMain.handle('github:get-user', async () => {
    if (!githubService) return null
    return githubService.getAuthenticatedUser()
  })

  ipcMain.handle('github:create-repo', async (_event, name: string, description: string, isPrivate: boolean) => {
    if (!githubService) return { success: false, error: 'GitHub service not ready' }
    try {
      const repo = await githubService.createRepository(name, description, isPrivate)
      return { success: true, repo }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('github:list-repos', async () => {
    if (!githubService) return { success: false, error: 'GitHub service not ready' }
    try {
      const repos = await githubService.listRepositories()
      return { success: true, repos }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('git:add-remote', async (_event, name: string, url: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try {
      await gitService['git'].addRemote(name, url)
      return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  // ── Git Service Wrapping ──────────────────────────────────────────────────────
  // ── Graph / Log ──────────────────────────────────────────────────────
  ipcMain.handle('git:log', async (_event, limit = 500) => {
    if (!gitService) return []
    try { return await gitService.getLog(limit) } catch { return [] }
  })

  ipcMain.handle('git:branches', async () => {
    if (!gitService) return { local: [], remote: [] }
    try { return await gitService.getBranches() } catch { return { local: [], remote: [] } }
  })

  ipcMain.handle('git:tags', async () => {
    if (!gitService) return []
    try { return await gitService.getTags() } catch { return [] }
  })

  ipcMain.handle('git:stashes', async () => {
    if (!gitService) return []
    try { return await gitService.getStashes() } catch { return [] }
  })

  ipcMain.handle('git:status', async () => {
    if (!gitService) return null
    try { return await gitService.getStatus() } catch { return null }
  })

  ipcMain.handle('git:remotes', async () => {
    if (!gitService) return []
    try { return await gitService.getRemotes() } catch { return [] }
  })

  // ── Commit Detail ────────────────────────────────────────────────────
  ipcMain.handle('git:commit-diff', async (_event, sha: string) => {
    if (!gitService) return ''
    try { return await gitService.getCommitDiff(sha) } catch { return '' }
  })

  ipcMain.handle('git:commit-files', async (_event, sha: string) => {
    if (!gitService) return []
    try { return await gitService.getCommitFiles(sha) } catch { return [] }
  })
  ipcMain.handle('git:file-diff', async (_event, filePath: string, staged: boolean, opts?: { wordDiff?: boolean }) => {
    if (!gitService) return ''
    try { return await gitService.getFileDiff(filePath, staged, opts ?? {}) } catch { return '' }
  })
  ipcMain.handle('git:commit-file-diff', async (_event, sha: string, filePath: string, opts?: { wordDiff?: boolean }) => {
    if (!gitService) return ''
    try { return await gitService.getCommitFileDiff(sha, filePath, opts ?? {}) } catch { return '' }
  })

  // ── Basic Operations ─────────────────────────────────────────────────
  ipcMain.handle('git:checkout', async (_event, branch: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { return await gitService.checkout(branch) }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:checkout-autostash', async (_event, branch: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.checkoutAutostash(branch)
  })

  ipcMain.handle('git:stage', async (_event, files: string[]) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.stage(files); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:unstage', async (_event, files: string[]) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.unstage(files); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:discard-changes', async (_event, files: string[], opts: { staged: boolean }) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.discardChanges(files, opts); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:discard-untracked', async (_event, files: string[]) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.discardUntracked(files); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  // Run a streaming commit/amend: push each stdout/stderr chunk to the renderer
  // tagged with the caller's runId, then a terminal `done` event. The invoke
  // still resolves with the final result (now incl. output/exitCode/hooksRan).
  const runStreamingCommit = async (
    opts: { subject: string; body?: string; noVerify?: boolean; signoff?: boolean; author?: string; amend?: boolean; runId?: string },
  ) => {
    if (!gitService) return { success: false, error: 'No repo' }
    const runId = opts.runId ?? ''
    try {
      const result = await gitService.commitStreaming(opts, ({ stream, chunk }) => {
        mainWindow?.webContents.send('git:commit-output', { runId, stream, chunk })
      })
      mainWindow?.webContents.send('git:commit-output', {
        runId, done: true, exitCode: result.exitCode, success: result.success,
      })
      return result
    } catch (e) {
      mainWindow?.webContents.send('git:commit-output', { runId, done: true, exitCode: null, success: false })
      return { success: false, error: String(e) }
    }
  }

  ipcMain.handle('git:commit', async (_event, opts) => runStreamingCommit(opts))
  ipcMain.handle('git:commit-amend', async (_event, opts) => runStreamingCommit({ ...opts, amend: true }))

  ipcMain.handle('git:set-head-author', async (_event, author: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.setHeadAuthor(author)
  })

  ipcMain.handle('git:head-author', async () => {
    if (!gitService) return ''
    return gitService.getHeadAuthor()
  })

  ipcMain.handle('git:commit-message', async (_event, sha?: string) => {
    if (!gitService) return ''
    return gitService.getCommitMessage(sha)
  })

  ipcMain.handle('git:log-pickaxe', async (_event, query: string, limit: number) => {
    if (!gitService) return []
    return gitService.logPickaxe(query, limit)
  })

  ipcMain.handle('git:stash-save', async (_event, message?: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.stashSave(message); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:stash-pop', async (_event, index: number) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.stashPop(index); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:stash-drop', async (_event, index: number) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.stashDrop(index); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:stash-apply', async (_event, index: number) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.stashApply(index); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:stash-branch', async (_event, name: string, index: number) => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.stashBranch(name, index)
  })

  ipcMain.handle('git:fetch', async () => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.fetch(); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:pull', async (_event, opts?: { rebase?: boolean; autoStash?: boolean }) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { return await gitService.pull(opts ?? {}) }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:push', async () => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { return await gitService.push() }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:create-branch', async (_event, name: string, startPoint?: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.createBranch(name, startPoint); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:delete-branch', async (_event, name: string, force = false) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.deleteBranch(name, force); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:rename-branch', async (_event, oldName: string, newName: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.renameBranch(oldName, newName); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:delete-remote-branch', async (_event, remote: string, branch: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.deleteRemoteBranch(remote, branch); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:merge', async (_event, branch: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.merge(branch); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:merge-current-into', async (_event, targetBranch: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.mergeCurrentInto(targetBranch)
  })

  ipcMain.handle('git:cherry-pick', async (_event, sha: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.cherryPick(sha); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:revert', async (_event, sha: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.revert(sha); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:squash-commits', async (_event, shas: string[], message: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.squashCommits(shas, message)
  })

  ipcMain.handle('git:drop-commits', async (_event, shas: string[]) => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.dropCommits(shas)
  })

  ipcMain.handle('git:cherry-pick-many', async (_event, shas: string[]) => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.cherryPickMany(shas)
  })

  ipcMain.handle('git:range-stat', async (_event, oldestSha: string, newestSha: string) => {
    if (!gitService) return null
    return gitService.rangeStat(oldestSha, newestSha)
  })

  ipcMain.handle('git:revert-many', async (_event, shas: string[]) => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.revertMany(shas)
  })

  ipcMain.handle('git:run-drag-action', async (_event, source: string, target: string, action: 'merge' | 'rebase' | 'checkout') => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.runDragAction(source, target, action)
  })

  ipcMain.handle('git:reset', async (_event, sha: string, mode: 'soft' | 'mixed' | 'hard') => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.reset(sha, mode); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:rebase-to', async (_event, sha: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.rebaseTo(sha)
  })

  ipcMain.handle('git:rebase-continue', async () => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.rebaseContinue()
  })
  ipcMain.handle('git:rebase-abort', async () => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.rebaseAbort()
  })
  ipcMain.handle('git:rebase-skip', async () => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.rebaseSkip()
  })
  ipcMain.handle('git:merge-continue', async () => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.mergeContinue()
  })
  ipcMain.handle('git:merge-abort', async () => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.mergeAbort()
  })
  ipcMain.handle('git:mark-resolved', async (_event, files: string[]) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.markResolved(files); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })
  ipcMain.handle('git:conflict-file', async (_event, filePath: string) => {
    if (!gitService) return { path: filePath, sections: [] }
    try { return await gitService.getConflictFile(filePath) }
    catch { return { path: filePath, sections: [] } }
  })
  ipcMain.handle('git:write-file', async (_event, filePath: string, content: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.writeFileContent(filePath, content); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:create-tag', async (_event, name: string, sha: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.createTag(name, sha); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  // ── Worktrees ────────────────────────────────────────────────────────
  ipcMain.handle('git:worktrees', async () => {
    if (!gitService) return []
    try { return await gitService.getWorktrees() } catch { return [] }
  })

  ipcMain.handle('git:worktree-add', async (_event, path: string, branch: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.addWorktree(path, branch)
  })

  ipcMain.handle('git:worktree-remove', async (_event, path: string, force?: boolean) => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.removeWorktree(path, force ?? false)
  })

  // ── Bisect ───────────────────────────────────────────────────────────
  ipcMain.handle('git:bisect-start', async () => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.bisectStart(); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:bisect-good', async (_event, sha?: string) => {
    if (!gitService) return ''
    try { return await gitService.bisectGood(sha) } catch { return '' }
  })

  ipcMain.handle('git:bisect-bad', async (_event, sha?: string) => {
    if (!gitService) return ''
    try { return await gitService.bisectBad(sha) } catch { return '' }
  })

  ipcMain.handle('git:bisect-reset', async () => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.bisectReset(); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  // ── Patch ────────────────────────────────────────────────────────────
  ipcMain.handle('git:format-patch', async (_event, sha: string) => {
    if (!gitService) return ''
    try { return await gitService.formatPatch(sha) } catch { return '' }
  })

  ipcMain.handle('git:apply-patch', async (_event, patchContent: string, opts: { reverse?: boolean, cached?: boolean } = {}) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.applyPatch(patchContent, opts); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  // Build a patch from selected working-tree files. `tracked`/`untracked` come
  // straight from the renderer's status snapshot.
  ipcMain.handle('git:working-patch', async (_event, tracked: string[] = [], untracked: string[] = []) => {
    if (!gitService) return ''
    try { return await gitService.buildWorkingPatch(tracked, untracked) } catch { return '' }
  })

  // Save patch text to a user-picked location. Returns the written path so the
  // renderer can show "saved here", or { canceled } if the dialog was dismissed.
  ipcMain.handle('patch:save', async (_event, content: string, defaultName: string) => {
    if (!content) return { success: false, error: 'Nothing to save' }
    const baseDir = gitService?.getRepoPath() ?? app.getPath('documents')
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save patch',
      defaultPath: join(baseDir, defaultName || 'changes.patch'),
      filters: [
        { name: 'Patch', extensions: ['patch', 'diff'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    try {
      fs.writeFileSync(result.filePath, content, 'utf8')
      return { success: true, path: result.filePath }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ── Reflog ───────────────────────────────────────────────────────────
  ipcMain.handle('git:reflog', async (_event, limit = 100) => {
    if (!gitService) return []
    try { return await gitService.getReflog(limit) } catch { return [] }
  })

})

app.on('window-all-closed', () => {
  stopRepoWatchers()
  if (process.platform !== 'darwin') app.quit()
})
