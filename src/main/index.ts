import { app, BrowserWindow, ipcMain, dialog, nativeImage, shell, safeStorage } from 'electron'
import { autoUpdater } from 'electron-updater'
import { MacUpdater } from './mac-updater'
import { defaultChannelFor, isUpdateChannel, type UpdateChannel } from './update-channel'
import { basename, join } from 'path'
import * as fs from 'fs'
import { spawn, type ChildProcess } from 'child_process'
import { GitService, redactAuthArgs, scrubSecrets, isIndexLockError, type GitActivity } from './git-service'
import { applyShellPath } from './shell-path'
import { GitHubService } from './github-service'
import { ProviderService, type HostedProvider } from './provider-service'
import { GerritService } from './gerrit-service'
import { detectGerrit, cookieHeaderForHost, type PushForReviewOptions } from './gerrit-utils'
import { PeerService } from './peer-service'
import { canonicalPath, createRepoHost, createRepoWatcher } from './peer-host-core'
import { isPeerRepoPath, type PeerEvent, type PeerRepoSummary } from './peer-protocol'

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
  // GITGUD_USER_DATA lets a second dev instance run with its own state — the
  // way to exercise peer connections on a single machine.
  app.setPath('userData', process.env.GITGUD_USER_DATA || join(app.getPath('appData'), 'git-gud-dev'))
}
// Version in the frame title: visible in the native title bar on Windows and
// Linux; macOS runs hiddenInset (no chrome title), so the renderer's tab bar
// shows a version chip instead.
const WINDOW_TITLE = `${IS_DEV_INSTANCE ? 'Git Gud (Dev)' : /-/.test(app.getVersion()) ? 'Git Gud (Dev build)' : 'Git Gud'} v${app.getVersion()}`

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
// Peer connections (other Git Gud instances on the LAN) — see peer-service.ts.
let peerService: PeerService | null = null
// Repos served to peers that aren't open as a tab here (lazy, allow-listed).

// Strip ANSI/VT escapes from console + activity output (no terminal emulator).
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

// Forward a git command record to the renderer, but only for the active repo so
// background services (e.g. tab validation) don't bleed into the log.
const emitActivity = (rec: GitActivity) => {
  if (rec.repoPath === activeRepoPath) mainWindow?.webContents.send('git:activity', rec)
  // Peers viewing this repo see the same command log live.
  peerService?.broadcastActivity(rec)
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
// A gitgud-peer:// path yields a RemoteRepoProxy instead — a GitService
// look-alike whose every call runs on the peer (see peer-client.ts).
const makeService = (repoPath: string): GitService => {
  if (isPeerRepoPath(repoPath)) {
    const proxy = peerService?.resolvePeerRepo(repoPath)
    if (!proxy) throw new Error('Unknown peer — pair with it first.')
    return proxy as unknown as GitService
  }
  return new GitService(repoPath, buildAuthConfigs, emitActivity)
}

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
// Watch one repo's .git for HEAD/ref changes (+ .gitignore edits) and report
// them debounced. Shared by the active-tab watcher and by the peer server,
// which watches repos other Git Gud instances are viewing. Returns the stop fn.
let stopActiveWatcher: (() => void) | null = null

function stopRepoWatchers() {
  stopActiveWatcher?.()
  stopActiveWatcher = null
}

function startRepoWatchers(repoPath: string) {
  stopRepoWatchers()
  // Remote repos: change events arrive over the peer stream instead.
  if (isPeerRepoPath(repoPath)) return
  stopActiveWatcher = createRepoWatcher(repoPath, (kind) => {
    if (kind === 'repo') peerService?.notifyRepoChanged(repoPath)
    mainWindow?.webContents.send(kind === 'repo' ? 'git:repo-changed' : 'git:gitignore-changed')
  })
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
// Update channel: "stable" follows GitHub's latest release, "dev" also
// accepts pre-releases (v1.11.0-dev.N from `pnpm release:dev`). Persisted in
// userData so a test machine stays on dev across restarts; a prerelease build
// with no saved choice defaults to dev (that's where it came from). Neither
// channel ever downgrades — a dev build switched back to stable just waits for
// the next stable version that outranks it.
const updateChannelFile = () => join(app.getPath('userData'), 'update-channel.json')
function readUpdateChannel(): UpdateChannel {
  try {
    const parsed = JSON.parse(fs.readFileSync(updateChannelFile(), 'utf8'))
    if (isUpdateChannel(parsed?.channel)) return parsed.channel
  } catch { /* first run / unreadable → default */ }
  return defaultChannelFor(app.getVersion())
}
function writeUpdateChannel(channel: UpdateChannel): void {
  fs.writeFileSync(updateChannelFile(), JSON.stringify({ channel }, null, 2))
}

function setupAutoUpdater(): void {
  // Version display works everywhere, including dev.
  ipcMain.handle('app:version', () => app.getVersion())

  let channel = readUpdateChannel()
  ipcMain.handle('updater:get-channel', () => channel)
  // Persist + apply, then re-check straight away so the Settings row shows
  // the outcome. `check` is filled in per platform below; in dev mode
  // (unpackaged) it stays a no-op and only the choice is saved.
  let check: () => Promise<{ success: boolean; version?: string; error?: string }> =
    async () => ({ success: false, error: 'Update checks only work in the installed app.' })
  ipcMain.handle('updater:set-channel', async (_e, next: unknown) => {
    if (!isUpdateChannel(next)) return { success: false, error: 'Unknown channel' }
    channel = next
    try { writeUpdateChannel(next) } catch (e) { return { success: false, error: String(e) } }
    autoUpdater.allowPrerelease = next === 'dev'
    return check()
  })

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
    }, () => channel)
    setTimeout(() => { mac.checkForUpdates().catch(() => {}) }, 5_000)
    check = async () => {
      try { const r = await mac.checkForUpdates(); return { success: true, version: r.version } }
      catch (e) { return { success: false, error: String(e) } }
    }
    ipcMain.handle('updater:check', check)
    ipcMain.handle('updater:install', () => { mac.quitAndInstall() })
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // electron-updater defaults allowPrerelease to "current version is a
  // prerelease" — make it follow the user's channel instead.
  autoUpdater.allowPrerelease = channel === 'dev'

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
  check = async () => {
    try { const r = await autoUpdater.checkForUpdates(); return { success: true, version: r?.updateInfo.version } }
    catch (e) { return { success: false, error: String(e) } }
  }
  ipcMain.handle('updater:check', check)
  ipcMain.handle('updater:install', () => {
    // Closes the app and restarts on the new version.
    autoUpdater.quitAndInstall()
  })
}

app.whenReady().then(async () => {
  // Before anything spawns git: a Dock/Finder launch inherits launchd's
  // minimal PATH, which hides Homebrew binaries git needs (gpg, git-lfs,
  // hook interpreters). No-op when launched from a terminal.
  await applyShellPath()

  // macOS dock icon — BrowserWindow.icon doesn't change the dock at runtime
  // on Darwin; app.dock.setIcon does. Silently skipped on other platforms.
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(nativeImage.createFromPath(ICON_PATH)) } catch { /* ignore */ }
  }

  githubService = new GitHubService()
  providerService = new ProviderService()
  gerritService = new GerritService()
  createWindow()

  // ── Peer connections ───────────────────────────────────────────────
  // Repos this instance will serve to paired peers: open tabs + saved tabs +
  // recent projects — never an arbitrary path.
  // Keyed by canonical path so /tmp/x and /private/tmp/x (macOS symlink) or
  // differently-cased Windows drives don't show up as two repos.
  const localRepoAllowList = (): Map<string, boolean> => {
    const out = new Map<string, boolean>()
    for (const p of services.keys()) if (!isPeerRepoPath(p)) out.set(canonicalPath(p), true)
    for (const t of getSavedTabs().tabs) {
      if (isPeerRepoPath(t.main)) continue
      const c = canonicalPath(t.main)
      if (!out.has(c)) out.set(c, false)
    }
    for (const p of getRecentProjects()) {
      if (isPeerRepoPath(p)) continue
      const c = canonicalPath(p)
      if (!out.has(c)) out.set(c, false)
    }
    return out
  }
  const safeCrypter = {
    encrypt: (plain: string) => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(plain) : Buffer.from(plain, 'utf8'),
    decrypt: (data: Buffer) => safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : data.toString('utf8'),
  }
  // Shared with the headless daemon (peer-host-core.ts): allow-list →
  // GitService cache → watchers. The GUI additionally reuses open tabs'
  // services so their watcher + activity keep flowing.
  const repoHost = createRepoHost<GitService>({
    allowList: localRepoAllowList,
    reuseService: (canonical) => {
      for (const [p, svc] of services) if (!isPeerRepoPath(p) && canonicalPath(p) === canonical) return svc as GitService
      return null
    },
    factory: (canonical) => new GitService(canonical, buildAuthConfigs, emitActivity),
  })
  peerService = new PeerService({
    userDataDir: app.getPath('userData'),
    crypter: safeCrypter,
    appVersion: app.getVersion(),
    listLocalRepos: () => repoHost.listRepos(),
    resolveLocalRepo: (requested) => repoHost.resolveRepo(requested),
    watchLocalRepo: (repoPath, onEvent) => repoHost.watchRepo(repoPath, onEvent),
    onRemoteRepoChanged: (peerRepoPath, kind) => {
      if (peerRepoPath === activeRepoPath) {
        mainWindow?.webContents.send(kind === 'repo' ? 'git:repo-changed' : 'git:gitignore-changed')
      }
    },
    onActivity: emitActivity,
    publish: (state) => mainWindow?.webContents.send('peer:state', state),
    log: (msg) => console.log(msg),
  })
  peerService.init().catch((e) => console.error('peer init failed', e))

  ipcMain.handle('peer:get-state', async () => peerService?.getState() ?? null)
  ipcMain.handle('peer:set-device-read-only', async (_event, peerId: string, readOnly: boolean) => peerService?.setDeviceReadOnly(peerId, readOnly) ?? false)
  ipcMain.handle('peer:set-server', async (_event, patch: { enabled?: boolean; port?: number; name?: string; readOnly?: boolean; push?: boolean }) => {
    if (!peerService) return null
    return peerService.setServer(patch ?? {})
  })
  ipcMain.handle('peer:regenerate-code', async () => peerService?.regenerateCode() ?? '')
  ipcMain.handle('peer:pairing-qr', async () => peerService?.pairingQr() ?? null)
  ipcMain.handle('peer:pair-payload', async (_event, text: string) => {
    try { const r = await peerService!.pairPayload(text); return { success: true, ...r } } catch (e) { return { success: false, error: String(e instanceof Error ? e.message : e) } }
  })
  ipcMain.handle('peer:revoke-device', async (_event, peerId: string) => peerService?.revokeDevice(peerId) ?? false)
  ipcMain.handle('peer:probe', async (_event, host: string, port: number) => {
    if (!peerService) return { success: false, error: 'Not available' }
    try { return { success: true, info: await peerService.probe(host, port) } }
    catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  })
  ipcMain.handle('peer:pair', async (_event, host: string, port: number, code: string) => {
    if (!peerService) return { success: false, error: 'Not available' }
    try { return { success: true, peer: await peerService.pair(host, port, code) } }
    catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  })
  ipcMain.handle('peer:connect', async (_event, peerId: string) => peerService?.connect(peerId) ?? false)
  ipcMain.handle('peer:disconnect', async (_event, peerId: string) => { peerService?.disconnect(peerId); return true })
  // Forget a peer: drops its credentials and every service for its tabs. The
  // renderer gets the orphaned tab paths back so it can close them.
  ipcMain.handle('peer:forget', async (_event, peerId: string) => {
    const dropped = peerService?.forget(peerId) ?? []
    for (const p of dropped) {
      services.delete(p)
      if (activeRepoPath === p) { stopRepoWatchers(); gitService = null; activeRepoPath = null }
    }
    return dropped
  })
  ipcMain.handle('peer:list-repos', async (_event, peerId: string) => {
    if (!peerService) return { success: false, error: 'Not available' }
    try { return { success: true, repos: await peerService.listRepos(peerId) } }
    catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
  })
  ipcMain.handle('peer:repo-path', async (_event, peerId: string, remotePath: string) =>
    peerService?.makePeerRepoPath(peerId, remotePath) ?? '')
  ipcMain.handle('peer:status-for', async (_event, peerRepoPath: string) => peerService?.peerStatusFor(peerRepoPath) ?? null)

  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // ── Repository ──────────────────────────────────────────────────────
  ipcMain.handle('git:open-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Open Git Repository',
      // Electron 43 defaults dialogs to ~/Downloads — home is the sane
      // starting point for hunting down a repo.
      defaultPath: app.getPath('home')
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
      // Electron 43 defaults dialogs to ~/Downloads — match default-clone-dir.
      defaultPath: app.getPath('home'),
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
    for (const p of [repoPath, ...extraPaths]) {
      services.delete(p)
      if (isPeerRepoPath(p)) peerService?.dropPeerRepo(p)
    }
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
      // A remote tab is restored as long as the peer is *known*; reachability
      // is checked when it's activated (the tab shows an error state + retry).
      if (isPeerRepoPath(repoPath)) { services.set(repoPath, candidate); return true }
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
    if (!path || isPeerRepoPath(path)) return false
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
  ipcMain.handle('git:log', async (_event, limit = 500, opts: { includeOtherRefs?: boolean } = {}) => {
    if (!gitService) return []
    try { return await gitService.getLog(limit, opts) } catch { return [] }
  })

  ipcMain.handle('git:other-ref-namespaces', async () => {
    if (!gitService) return []
    try { return await gitService.getOtherRefNamespaces() } catch { return [] }
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
  ipcMain.handle('git:file-diff', async (_event, filePath: string, staged: boolean, opts?: { wordDiff?: boolean; ignoreWhitespace?: boolean; fullUntracked?: boolean }) => {
    if (!gitService) return { diff: '' }
    try { return await gitService.getFileDiff(filePath, staged, opts ?? {}) } catch { return { diff: '' } }
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

  ipcMain.handle('git:fast-forward-branch', async (_event, branchName: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { return await gitService.fastForwardBranch(branchName) }
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
    try {
      const { alreadyGone } = await gitService.deleteRemoteBranch(remote, branch)
      return { success: true, alreadyGone }
    }
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
    if (isPeerRepoPath(activeRepoPath)) {
      const msg = 'The command console runs locally — it is not available for a repository on another machine.'
      mainWindow?.webContents.send('console:output', { runId, stream: 'stderr', chunk: msg + '\n' })
      mainWindow?.webContents.send('console:output', { runId, done: true, exitCode: null })
      return { success: false, error: msg }
    }
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
    try {
      const { alreadyGone } = await gitService.deleteRemoteTag(remote, name)
      return { success: true, alreadyGone }
    }
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

  ipcMain.handle('git:apply-patch', async (_event, patchContent: string, opts: { reverse?: boolean, cached?: boolean, ignoreWhitespace?: boolean } = {}) => {
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

app.on('before-quit', () => { peerService?.shutdown() })

app.on('window-all-closed', () => {
  stopRepoWatchers()
  if (process.platform !== 'darwin') app.quit()
})
