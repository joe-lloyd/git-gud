import { app, BrowserWindow, ipcMain, dialog, nativeImage, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { MacUpdater } from './mac-updater'
import { basename, join } from 'path'
import * as fs from 'fs'
import { spawn, type ChildProcess } from 'child_process'
import { GitService, redactAuthArgs, scrubSecrets, isIndexLockError, type GitActivity } from './git-service'
import { GitHubService } from './github-service'
import { ProviderService, type HostedProvider } from './provider-service'
import { GerritService } from './gerrit-service'
import { detectGerrit, cookieHeaderForHost, type PushForReviewOptions } from './gerrit-utils'

// App icon — resources/icon.png is rasterized from icon.svg by scripts/render-icon.cjs.
// In dev `__dirname` is out/main, in prod it's inside the bundle; both sit one
// level under the project root, so ../../resources resolves either way.
const ICON_PATH = join(__dirname, '..', '..', 'resources', 'icon.png')

// ── Dev-instance isolation ───────────────────────────────────────────────
// An unpackaged (pnpm dev) build must be able to run NEXT TO the installed
// app without touching its state: distinct app name and userData directory
// mean separate open-tabs.json, recent-projects.json, and credential stores.
// There is no single-instance lock in this app, so both can run at once; the
// auto-updater is already a dev no-op. Applied before anything reads
// app.getPath('userData').
const IS_DEV_INSTANCE = !app.isPackaged
if (IS_DEV_INSTANCE) {
  app.setName('git-gud-dev')
  app.setPath('userData', join(app.getPath('appData'), 'git-gud-dev'))
}
// Version in the frame title: visible in the native title bar on Windows and
// Linux; macOS runs hiddenInset (no chrome title), so the renderer's tab bar
// shows a version chip instead.
const WINDOW_TITLE = `${IS_DEV_INSTANCE ? 'Git Gud (Dev)' : 'Git Gud'} v${app.getVersion()}`

let mainWindow: BrowserWindow | null = null
// All loaded repos — one GitService per open tab.
const services = new Map<string, GitService>()
// The active service is what every IPC handler reads/writes against.
// Renderer flips this via `git:activate-path` when switching tabs.
let gitService: GitService | null = null
let activeRepoPath: string | null = null
let githubService: GitHubService | null = null
let providerService: ProviderService | null = null
let gerritService: GerritService | null = null

// Strip ANSI/VT escapes from console + activity output (no terminal emulator).
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

// Forward a git command record to the renderer, but only for the active repo so
// background services (e.g. tab validation) don't bleed into the log.
const emitActivity = (rec: GitActivity) => {
  if (rec.repoPath === activeRepoPath) mainWindow?.webContents.send('git:activity', rec)
}

// `-c http.<host>.extraheader=…` pairs for every signed-in host — GitHub
// (OAuth token) plus GitLab / Bitbucket via ProviderService. Shared by every
// GitService and by the top-level clone handler (which has no service yet).
function buildAuthConfigs(): string[] {
  const configs: string[] = []
  const ghToken = githubService?.getToken()
  if (ghToken) {
    const b64 = Buffer.from(`x-access-token:${ghToken}`).toString('base64')
    configs.push('-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${b64}`)
  }
  if (providerService) configs.push(...providerService.getGitAuthConfigs())
  return configs
}

// Build a GitService wired for auth + activity logging (one place, all call
// sites).
const makeService = (repoPath: string): GitService =>
  new GitService(repoPath, buildAuthConfigs, emitActivity)

// Derive a default folder name from a clone URL: strip query/fragment and
// trailing slashes, take the last path segment (handles both https and
// scp-like `git@host:owner/repo.git`), drop the `.git` suffix.
function deriveRepoName(url: string): string {
  const s = url.trim().replace(/[?#].*$/, '').replace(/[/\\]+$/, '')
  const seg = s.split(/[/:]/).pop() ?? ''
  return seg.replace(/\.git$/i, '')
}

// git clone --progress writes phase lines to stderr, e.g.
// "Receiving objects:  73% (1234/1690)". Return the LAST match in the chunk
// (a single read may carry several \r-separated updates).
function parseCloneProgress(chunk: string): { phase: string; percent: number } | null {
  const re = /([A-Za-z][A-Za-z ]+?):\s+(\d+)%/g
  let last: RegExpExecArray | null = null
  for (let m = re.exec(chunk); m; m = re.exec(chunk)) last = m
  if (!last) return null
  return { phase: last[1].trim(), percent: Number(last[2]) }
}

// Pull the most relevant line out of a failed clone's stderr for the toast.
function extractCloneError(out: string): string {
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean)
  const fatal = [...lines].reverse().find((l) => /^(fatal|error):/i.test(l))
  return fatal ?? lines[lines.length - 1] ?? ''
}

// In-flight command-console children, keyed by run id, so they can be cancelled.
const consoleProcs = new Map<string, ChildProcess>()
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
    svc = makeService(repoPath)
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

  // 2) .git internals — HEAD + refs/ + packed-refs (+ merge/rebase sentinels).
  // Do NOT watch .git/index or .git/logs — both are touched by read-only ops
  // (status, log) and would cause infinite refresh loops.
  //
  // HEAD and packed-refs are watched via their PARENT directory, not as files:
  // git updates them by write-to-lock-then-rename, and a file watch dies
  // silently after the first rename on Windows (and sometimes macOS). A
  // non-recursive directory watch survives renames.
  const gitDir = join(repoPath, '.git')
  const SENTINELS = new Set(['HEAD', 'packed-refs', 'MERGE_HEAD', 'ORIG_HEAD'])
  try {
    if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
      repoWatchers.push(
        fs.watch(gitDir, { persistent: false }, (_evt, filename) => {
          if (filename && SENTINELS.has(filename.replace(/\.lock$/, ''))) emit()
        }),
      )
    }
  } catch { /* unwatchable — fall back to focus-refresh */ }
  const refsDir = join(gitDir, 'refs')
  try {
    if (fs.existsSync(refsDir)) {
      repoWatchers.push(
        fs.watch(refsDir, { persistent: false, recursive: true }, () => emit()),
      )
    }
  } catch { /* recursive unsupported or transient — fall back to focus-refresh */ }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: WINDOW_TITLE,
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
  // The renderer's <title> would overwrite the BrowserWindow title on load —
  // keep the version (and the (Dev) marker) in the frame title everywhere.
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault()
    mainWindow?.setTitle(WINDOW_TITLE)
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
// macOS uses the custom MacUpdater: the app ships unsigned (identity: null)
// and electron-updater's Squirrel.Mac path refuses to swap unsigned bundles —
// its "restart" silently did nothing. Windows/Linux stay on electron-updater.
function setupAutoUpdater(): void {
  // Version display works everywhere, including dev.
  ipcMain.handle('app:version', () => app.getVersion())

  if (!app.isPackaged) return  // dev mode

  // Mirror updater progress into the frame title so Windows/Linux users see
  // it without any in-app chrome (macOS shows the tab-bar chip instead).
  let pendingVersion = ''
  const send = (channel: string, payload?: unknown) => {
    mainWindow?.webContents.send(channel, payload)
    if (channel === 'updater:status') {
      const s = payload as { state: string; version?: string }
      if (s.state === 'available') pendingVersion = s.version ?? ''
      else if (s.state === 'downloaded') mainWindow?.setTitle(`${WINDOW_TITLE} — restart for v${s.version}`)
      else if (s.state === 'none' || s.state === 'error') mainWindow?.setTitle(WINDOW_TITLE)
    } else if (channel === 'updater:progress') {
      const p = payload as { percent: number }
      mainWindow?.setTitle(`${WINDOW_TITLE} — downloading v${pendingVersion} ${Math.round(p.percent)}%`)
    }
  }

  if (process.platform === 'darwin') {
    const mac = new MacUpdater({
      onStatus: (s) => send('updater:status', s),
      onProgress: (p) => send('updater:progress', p),
    })
    setTimeout(() => { mac.checkForUpdates().catch(() => {}) }, 5_000)
    ipcMain.handle('updater:check', async () => {
      try { const r = await mac.checkForUpdates(); return { success: true, version: r.version } }
      catch (e) { return { success: false, error: String(e) } }
    })
    ipcMain.handle('updater:install', () => { mac.quitAndInstall() })
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => send('updater:status', { state: 'checking' }))
  autoUpdater.on('update-available', (info) => send('updater:status', { state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => send('updater:status', { state: 'none' }))
  autoUpdater.on('error', (err) => send('updater:status', { state: 'error', error: String(err) }))
  autoUpdater.on('download-progress', (p) => send('updater:progress', { percent: p.percent }))
  autoUpdater.on('update-downloaded', (info) => send('updater:status', { state: 'downloaded', version: info.version }))

  // One check shortly after launch (give the renderer time to subscribe).
  // electron-updater does NOT poll by itself — later checks come from the
  // toolbar "Check for updates" button via the updater:check IPC below.
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
  providerService = new ProviderService()
  gerritService = new GerritService()
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
    const candidate = makeService(repoPath)
    const isRepo = await candidate.isRepo()
    if (!isRepo) {
      const { response } = await dialog.showMessageBox(mainWindow!, {
        type: 'question',
        title: 'Not a Git repository',
        message: `"${basename(repoPath)}" is not a Git repository.`,
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
    return repoPath
  })

  ipcMain.handle('git:open-path', async (_event, repoPath: string) => {
    try {
      // Already loaded? Just re-activate.
      if (services.has(repoPath)) {
        activateRepo(repoPath)
        return true
      }
      const candidate = makeService(repoPath)
      const isRepo = await candidate.isRepo()
      if (!isRepo) return false
      services.set(repoPath, candidate)
      activateRepo(repoPath)
      return true
    } catch { return false }
  })

  // ── Clone ───────────────────────────────────────────────────────────
  // Pick the parent folder the repo will be cloned into.
  ipcMain.handle('git:clone-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose a folder to clone into',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // A sensible default parent for clones when the user hasn't picked one.
  ipcMain.handle('app:default-clone-dir', async () => app.getPath('home'))

  // Clone `url` into `parentDir/name`. Auth headers for every signed-in host are
  // injected so private repos clone without a credential helper. Progress lines
  // stream to the renderer on `git:clone-progress`; the invoke resolves with the
  // final repo path (the renderer opens it as a tab).
  ipcMain.handle('git:clone', async (_event, opts: { url: string; parentDir: string; name?: string }) => {
    const url = String(opts?.url ?? '').trim()
    if (!url) return { success: false, error: 'Enter a repository URL.' }
    const parentDir = String(opts?.parentDir ?? '').trim()
    if (!parentDir) return { success: false, error: 'Choose a destination folder.' }

    const name = (opts?.name?.trim() || deriveRepoName(url)).replace(/[/\\]/g, '')
    if (!name) return { success: false, error: 'Could not determine a folder name — enter one.' }
    const dest = join(parentDir, name)

    // Refuse to clone into an existing non-empty directory (git would too, but
    // this gives a clearer message before we spawn anything).
    try {
      if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) {
        return { success: false, error: `"${name}" already exists in that folder and isn't empty.` }
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }

    const authConfigs = buildAuthConfigs()
    const { secrets } = redactAuthArgs(authConfigs)
    const args = [...authConfigs, 'clone', '--progress', url, dest]
    const send = (payload: Record<string, unknown>) =>
      mainWindow?.webContents.send('git:clone-progress', payload)

    return new Promise((resolve) => {
      let child: ChildProcess
      try {
        child = spawn('git', args, { env: process.env })
      } catch (e) {
        resolve({ success: false, error: scrubSecrets(String(e), secrets) })
        return
      }
      let errBuf = ''
      child.stderr?.on('data', (d: Buffer) => {
        const chunk = scrubSecrets(d.toString('utf8').replace(ANSI_RE, ''), secrets)
        errBuf += chunk
        if (errBuf.length > 100_000) errBuf = errBuf.slice(-100_000)
        const prog = parseCloneProgress(chunk)
        if (prog) send({ phase: prog.phase, percent: prog.percent })
      })
      child.on('error', (err) => resolve({ success: false, error: scrubSecrets(String(err), secrets) }))
      child.on('close', (code) => {
        if (code === 0) resolve({ success: true, path: dest })
        else resolve({ success: false, error: extractCloneError(errBuf) || `git clone exited with code ${code}` })
      })
    })
  })

  // Flip the active tab. Returns false if the path isn't loaded yet.
  ipcMain.handle('git:activate-path', async (_event, repoPath: string) => {
    if (!services.has(repoPath)) return false
    activateRepo(repoPath)
    return true
  })

  // Close a tab — drop the service(s), stop the watcher if it was active.
  // The renderer passes every path that belonged to the tab (main worktree +
  // any linked worktrees it activated) so their cached services go too.
  ipcMain.handle('git:close-tab', async (_event, repoPath: string, extraPaths: string[] = []) => {
    for (const p of [repoPath, ...extraPaths]) services.delete(p)
    if (activeRepoPath === repoPath || extraPaths.includes(activeRepoPath ?? '')) {
      stopRepoWatchers()
      gitService = null
      activeRepoPath = null
    }
    return true
  })

  ipcMain.handle('git:active-path', async () => activeRepoPath)
  ipcMain.handle('git:open-tabs', async () => Array.from(services.keys()))

  // ── Session: persisted tabs ─────────────────────────────────────────────────
  // One tab per repository: each entry stores the repo's main worktree path
  // (tab identity) plus the worktree that was active in it. The renderer owns
  // the tab list and persists it via app:save-tabs; older files that held a
  // plain string list still restore (each path becomes its own tab).

  type SavedTab = { main: string; worktree: string }
  const tabsFile = join(app.getPath('userData'), 'open-tabs.json')

  function getSavedTabs(): { tabs: SavedTab[]; active: string | null } {
    try {
      if (fs.existsSync(tabsFile)) {
        const parsed = JSON.parse(fs.readFileSync(tabsFile, 'utf8'))
        const raw = Array.isArray(parsed?.tabs) ? parsed.tabs : []
        const tabs: SavedTab[] = raw
          .map((t: unknown): SavedTab | null => {
            if (typeof t === 'string') return { main: t, worktree: t } // legacy shape
            if (t && typeof (t as any).main === 'string') {
              return { main: (t as any).main, worktree: typeof (t as any).worktree === 'string' ? (t as any).worktree : (t as any).main }
            }
            return null
          })
          .filter((t: SavedTab | null): t is SavedTab => t !== null)
        const active = typeof parsed?.active === 'string' ? parsed.active : null
        return { tabs, active }
      }
    } catch (e) {
      console.error('Failed to read saved tabs', e)
    }
    return { tabs: [], active: null }
  }

  ipcMain.handle('app:save-tabs', async (_event, payload: { tabs: SavedTab[]; active: string | null }) => {
    try {
      fs.writeFileSync(tabsFile, JSON.stringify(payload, null, 2))
      return true
    } catch (e) {
      console.error('Failed to save tabs', e)
      return false
    }
  })

  // Open a tab WITHOUT making it active — used at startup to restore a session
  // of N tabs and only activate one at the end. Returns false if the path is
  // no longer a valid repo (silently dropped from the restored list).
  ipcMain.handle('git:add-tab', async (_event, repoPath: string) => {
    try {
      if (services.has(repoPath)) return true
      const candidate = makeService(repoPath)
      const isRepo = await candidate.isRepo()
      if (!isRepo) return false
      services.set(repoPath, candidate)
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

  // Open a URL in the system browser. Renderer code can't reach electron's
  // shell directly (contextIsolation), so this is the one sanctioned door out.
  ipcMain.handle('app:open-external', async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) return false
    await shell.openExternal(url)
    return true
  })

  // Reveal a folder in the OS file manager (Explorer/Finder). Used by the
  // sidebar repo-name button to open the current project's folder.
  ipcMain.handle('app:show-in-folder', async (_event, path: string) => {
    if (!path) return false
    const err = await shell.openPath(path)
    return err === ''
  })

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

  // ── GitLab / Bitbucket Integration ─────────────────────────────────────────
  ipcMain.handle('provider:signin-gitlab', async (_event, host: string, token: string) => {
    try { return { success: true, user: await providerService!.signInGitLab(host, token) } }
    catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('provider:signin-bitbucket', async (_event, username: string, token: string) => {
    try { return { success: true, user: await providerService!.signInBitbucket(username, token) } }
    catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('provider:signout', async (_event, provider: HostedProvider) => {
    providerService?.signOut(provider)
    return true
  })

  ipcMain.handle('provider:get-user', async (_event, provider: HostedProvider) => {
    if (!providerService) return null
    return providerService.getUser(provider)
  })

  ipcMain.handle('provider:create-repo', async (_event, provider: HostedProvider, name: string, description: string, isPrivate: boolean) => {
    try { return { success: true, repo: await providerService!.createRepo(provider, name, description, isPrivate) } }
    catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('provider:list-repos', async (_event, provider: HostedProvider) => {
    try { return { success: true, repos: await providerService!.listRepos(provider) } }
    catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('git:add-remote', async (_event, name: string, url: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try {
      await gitService['git'].addRemote(name, url)
      return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  // ── Gerrit ──────────────────────────────────────────────────────────────
  // Detection is read-only; the mode flag itself is repo git config written
  // by the renderer through git:config-set. Credentials stay in main.
  ipcMain.handle('gerrit:detect', async () => {
    if (!gitService || !activeRepoPath) return { likely: false, signals: [] }
    try {
      const remotes = await gitService.getRemotes()
      return detectGerrit(activeRepoPath, remotes)
    } catch { return { likely: false, signals: [] } }
  })

  ipcMain.handle('gerrit:push-for-review', async (_event, opts: PushForReviewOptions) => {
    if (!gitService) return { success: false, error: 'No repo', kind: 'unknown' }
    try { return await gitService.pushForReview(opts) }
    catch (e) { return { success: false, error: String(e), kind: 'unknown' } }
  })

  // Cookie header for `host` from git's own http.cookiefile (the auth git
  // push/pull already uses, e.g. ~/.gitcookies on googlesource hosts). Stays
  // in main — the renderer never sees credential values.
  const gerritCookieHeader = async (host: string): Promise<string | undefined> => {
    try {
      const configured = await gitService?.getConfig('http.cookiefile')
      if (!configured) return undefined
      const cookiePath = configured.replace(/^~(?=$|\/)/, app.getPath('home'))
      if (!fs.existsSync(cookiePath)) return undefined
      return cookieHeaderForHost(fs.readFileSync(cookiePath, 'utf8'), host)
    } catch { return undefined }
  }

  ipcMain.handle('gerrit:list-changes', async (_event, host: string, project: string) => {
    if (!gerritService) return { success: false, error: 'Not available' }
    if (!host || !project) return { success: false, error: 'Gerrit host or project not configured' }
    try {
      const cookieHeader = await gerritCookieHeader(host)
      const changes = await gerritService.listOpenChanges(host, project, cookieHeader)
      return { success: true, changes, auth: gerritService.authModeFor(host, cookieHeader) }
    } catch (e) { return { success: false, error: String(e instanceof Error ? e.message : e) } }
  })

  // Mirror open changes into refs/gitgud/changes/* so the graph shows them.
  ipcMain.handle('gerrit:sync-change-refs', async (_event, remote: string, changes: Array<{ number: number; currentRef?: string }>) => {
    if (!gitService) return { success: false, error: 'No repo', fetched: 0, pruned: 0 }
    return gitService.syncGerritChangeRefs(remote, changes)
  })

  ipcMain.handle('gerrit:clear-change-refs', async () => {
    if (!gitService) return 0
    try { return await gitService.clearGerritChangeRefs() } catch { return 0 }
  })

  ipcMain.handle('gerrit:set-auth', async (_event, host: string, username: string, password: string) => {
    if (!gerritService) return { success: false, error: 'Not available' }
    try { gerritService.setAuth(host, username, password); return { success: true } }
    catch (e) { return { success: false, error: String(e instanceof Error ? e.message : e) } }
  })

  ipcMain.handle('gerrit:clear-auth', async (_event, host: string) => {
    try { gerritService?.clearAuth(host); return true } catch { return false }
  })

  ipcMain.handle('gerrit:auth-status', async (_event, host: string) => {
    return gerritService?.hasAuth(host) ?? false
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
  ipcMain.handle('git:file-diff', async (_event, filePath: string, staged: boolean, opts?: { wordDiff?: boolean; ignoreWhitespace?: boolean }) => {
    if (!gitService) return ''
    try { return await gitService.getFileDiff(filePath, staged, opts ?? {}) } catch { return '' }
  })
  ipcMain.handle('git:commit-file-diff', async (_event, sha: string, filePath: string, opts?: { wordDiff?: boolean; ignoreWhitespace?: boolean }) => {
    if (!gitService) return ''
    try { return await gitService.getCommitFileDiff(sha, filePath, opts ?? {}) } catch { return '' }
  })
  ipcMain.handle('git:file-diff-sources', async (_event, filePath: string, staged: boolean) => {
    if (!gitService) return { oldText: '', newText: '' }
    try { return await gitService.getFileDiffSources(filePath, staged) } catch { return { oldText: '', newText: '' } }
  })
  ipcMain.handle('git:commit-file-diff-sources', async (_event, sha: string, filePath: string) => {
    if (!gitService) return { oldText: '', newText: '' }
    try { return await gitService.getCommitFileDiffSources(sha, filePath) } catch { return { oldText: '', newText: '' } }
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

  // A stale `.git/index.lock` (crashed git process) fails every index write with
  // a fatal the user can't act on from the GUI. Flag it so the renderer can
  // offer "Remove Lock & Retry" instead of just printing the error.
  const indexWrite = async (run: () => Promise<void>) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await run(); return { success: true } }
    catch (e) {
      return { success: false, error: String(e), indexLocked: isIndexLockError(e) || undefined }
    }
  }

  ipcMain.handle('git:stage', async (_event, files: string[]) =>
    indexWrite(() => gitService!.stage(files)))

  ipcMain.handle('git:unstage', async (_event, files: string[]) =>
    indexWrite(() => gitService!.unstage(files)))

  ipcMain.handle('git:remove-index-lock', async () => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.removeIndexLock()
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

  // Run a streaming commit/amend. The full command + hook output surfaces in the
  // git-activity console via commitStreaming's own `git:activity` record; the
  // invoke resolves with the final result (incl. output/exitCode/hooksRan).
  const runStreamingCommit = async (
    opts: { subject: string; body?: string; noVerify?: boolean; signoff?: boolean; author?: string; amend?: boolean; runId?: string },
  ) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try {
      return await gitService.commitStreaming(opts, () => { /* output goes to the git-activity log */ })
    } catch (e) {
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

  ipcMain.handle('git:push', async (_event, force?: boolean) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { return await gitService.push(force ?? false) }
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

  // ── Command console ──────────────────────────────────────────────────────
  // Runs a NON-interactive shell command at the active worktree root, streaming
  // stdout/stderr to the renderer keyed by runId. Security: user-typed, local,
  // app-privilege — equivalent to the user's own terminal (documented POC).
  ipcMain.handle('console:cwd', async () => activeRepoPath)

  ipcMain.handle('console:run', async (_event, runId: string, cmd: string) => {
    if (!activeRepoPath) return { success: false, error: 'No repository open' }
    // Windows has no /bin/sh — use cmd.exe (or ComSpec) with /d /s /c there.
    const isWin = process.platform === 'win32'
    const shellBin = isWin
      ? (process.env.ComSpec || 'cmd.exe')
      : (process.env.SHELL || '/bin/sh')
    const shellArgs = isWin ? ['/d', '/s', '/c', cmd] : ['-c', cmd]
    const send = (payload: Record<string, unknown>) =>
      mainWindow?.webContents.send('console:output', { runId, ...payload })

    let child: ChildProcess
    try {
      child = spawn(shellBin, shellArgs, {
        cwd: activeRepoPath,
        env: process.env,
        // cmd.exe needs the raw command string; disable arg quoting on Windows.
        ...(isWin ? { windowsVerbatimArguments: true } : {}),
      })
    } catch (e) {
      send({ stream: 'stderr', chunk: String(e) + '\n' })
      send({ done: true, exitCode: null })
      return { success: false, error: String(e) }
    }
    consoleProcs.set(runId, child)
    child.stdout?.on('data', (d: Buffer) => send({ stream: 'stdout', chunk: d.toString('utf8').replace(ANSI_RE, '') }))
    child.stderr?.on('data', (d: Buffer) => send({ stream: 'stderr', chunk: d.toString('utf8').replace(ANSI_RE, '') }))

    return new Promise((resolve) => {
      child.on('error', (err) => {
        consoleProcs.delete(runId)
        send({ stream: 'stderr', chunk: String(err) + '\n' })
        send({ done: true, exitCode: null })
        resolve({ success: false, error: String(err) })
      })
      child.on('close', (code) => {
        consoleProcs.delete(runId)
        send({ done: true, exitCode: code })
        resolve({ success: code === 0, exitCode: code })
      })
    })
  })

  ipcMain.handle('console:cancel', async (_event, runId: string) => {
    const child = consoleProcs.get(runId)
    if (child) { try { child.kill('SIGTERM') } catch { /* already gone */ } }
    return true
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

  ipcMain.handle('git:delete-tag', async (_event, name: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.deleteTag(name); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:rename-tag', async (_event, oldName: string, newName: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.renameTag(oldName, newName); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:push-tag', async (_event, remote: string, name: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.pushTag(remote, name); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:delete-remote-tag', async (_event, remote: string, name: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { await gitService.deleteRemoteTag(remote, name); return { success: true } }
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

  ipcMain.handle('git:reflog-restore', async (_event, sha: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.restoreFromReflog(sha)
  })

  ipcMain.handle('git:clean-preview', async (_event, opts: { dirs: boolean; ignored: boolean }) => {
    if (!gitService) return []
    return gitService.cleanPreview(opts)
  })

  ipcMain.handle('git:clean', async (_event, paths: string[], opts: { dirs: boolean; ignored: boolean }) => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.clean(paths, opts)
  })

  ipcMain.handle('git:config-get', async (_event, key: string) => {
    if (!gitService) return ''
    return gitService.getConfig(key)
  })

  ipcMain.handle('git:config-set', async (_event, key: string, value: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.setConfig(key, value)
  })

  ipcMain.handle('git:rerere-status', async () => {
    if (!gitService) return []
    return gitService.rerereStatus()
  })

  ipcMain.handle('git:rerere-forget', async (_event, path: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    return gitService.rerereForget(path)
  })

})

app.on('window-all-closed', () => {
  stopRepoWatchers()
  if (process.platform !== 'darwin') app.quit()
})
