import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { GitService } from './git-service'
import { GitHubService } from './github-service'

let mainWindow: BrowserWindow | null = null
let gitService: GitService | null = null
let githubService: GitHubService | null = null
let gitignoreWatcher: fs.FSWatcher | null = null

function startGitignoreWatcher(repoPath: string) {
  // Clean up previous watcher
  if (gitignoreWatcher) { gitignoreWatcher.close(); gitignoreWatcher = null }
  // Watch the repo root directory for any .gitignore file changes
  gitignoreWatcher = fs.watch(repoPath, { persistent: false }, (_evt, filename) => {
    if (filename && filename.endsWith('.gitignore')) {
      mainWindow?.webContents.send('git:gitignore-changed')
    }
  })
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

app.whenReady().then(() => {
  githubService = new GitHubService()
  createWindow()

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
    gitService = new GitService(repoPath)
    const isRepo = await gitService.isRepo()
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
      if (response === 1) { gitService = null; return null }
      // Run git init then reload
      try {
        await gitService['git'].init()
      } catch (e) {
        await dialog.showMessageBox(mainWindow!, {
          type: 'error',
          title: 'Git init failed',
          message: String(e),
        })
        gitService = null
        return null
      }
    }
    startGitignoreWatcher(repoPath)
    return repoPath

  })

  ipcMain.handle('git:open-path', async (_event, repoPath: string) => {
    try {
      gitService = new GitService(repoPath)
      const isRepo = await gitService.isRepo()
      if (!isRepo) { gitService = null; return false }
      return true
    } catch { gitService = null; return false }
  })

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
  ipcMain.handle('git:file-diff', async (_event, filePath: string, staged: boolean) => {
    if (!gitService) return ''
    try { return await gitService.getFileDiff(filePath, staged) } catch { return '' }
  })

  // ── Basic Operations ─────────────────────────────────────────────────
  ipcMain.handle('git:checkout', async (_event, branch: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { return await gitService.checkout(branch) }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:stage', async (_event, files: string[]) => {
    if (!gitService) return false
    try { await gitService.stage(files); return true } catch { return false }
  })

  ipcMain.handle('git:unstage', async (_event, files: string[]) => {
    if (!gitService) return false
    try { await gitService.unstage(files); return true } catch { return false }
  })

  ipcMain.handle('git:commit', async (_event, message: string) => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { return await gitService.commit(message) }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:stash-save', async (_event, message?: string) => {
    if (!gitService) return false
    try { await gitService.stashSave(message); return true } catch { return false }
  })

  ipcMain.handle('git:stash-pop', async (_event, index: number) => {
    if (!gitService) return false
    try { await gitService.stashPop(index); return true } catch { return false }
  })

  ipcMain.handle('git:stash-drop', async (_event, index: number) => {
    if (!gitService) return false
    try { await gitService.stashDrop(index); return true } catch { return false }
  })

  ipcMain.handle('git:fetch', async () => {
    if (!gitService) return false
    try { await gitService.fetch(); return true } catch { return false }
  })

  ipcMain.handle('git:pull', async () => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { return await gitService.pull() }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:push', async () => {
    if (!gitService) return { success: false, error: 'No repo' }
    try { return await gitService.push() }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('git:create-branch', async (_event, name: string, startPoint?: string) => {
    if (!gitService) return false
    try { await gitService.createBranch(name, startPoint); return true } catch { return false }
  })

  ipcMain.handle('git:delete-branch', async (_event, name: string, force = false) => {
    if (!gitService) return false
    try { await gitService.deleteBranch(name, force); return true } catch { return false }
  })

  ipcMain.handle('git:merge', async (_event, branch: string) => {
    if (!gitService) return false
    try { await gitService.merge(branch); return true } catch { return false }
  })

  ipcMain.handle('git:cherry-pick', async (_event, sha: string) => {
    if (!gitService) return false
    try { await gitService.cherryPick(sha); return true } catch { return false }
  })

  // ── Worktrees ────────────────────────────────────────────────────────
  ipcMain.handle('git:worktrees', async () => {
    if (!gitService) return []
    try { return await gitService.getWorktrees() } catch { return [] }
  })

  ipcMain.handle('git:worktree-add', async (_event, path: string, branch: string) => {
    if (!gitService) return false
    try { await gitService.addWorktree(path, branch); return true } catch { return false }
  })

  ipcMain.handle('git:worktree-remove', async (_event, path: string) => {
    if (!gitService) return false
    try { await gitService.removeWorktree(path); return true } catch { return false }
  })

  // ── Bisect ───────────────────────────────────────────────────────────
  ipcMain.handle('git:bisect-start', async () => {
    if (!gitService) return false
    try { await gitService.bisectStart(); return true } catch { return false }
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
    if (!gitService) return false
    try { await gitService.bisectReset(); return true } catch { return false }
  })

  // ── Patch ────────────────────────────────────────────────────────────
  ipcMain.handle('git:format-patch', async (_event, sha: string) => {
    if (!gitService) return ''
    try { return await gitService.formatPatch(sha) } catch { return '' }
  })

  ipcMain.handle('git:apply-patch', async (_event, patchContent: string, opts: { reverse?: boolean, cached?: boolean } = {}) => {
    if (!gitService) return false
    try { await gitService.applyPatch(patchContent, opts); return true } catch { return false }
  })

  // ── Reflog ───────────────────────────────────────────────────────────
  ipcMain.handle('git:reflog', async (_event, limit = 100) => {
    if (!gitService) return []
    try { return await gitService.getReflog(limit) } catch { return [] }
  })

})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
