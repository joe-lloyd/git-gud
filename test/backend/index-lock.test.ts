import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitService, isIndexLockError } from '../../src/main/git-service'
import simpleGit, { SimpleGit } from 'simple-git'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'

describe('isIndexLockError', () => {
  it('matches git\'s POSIX lock fatal', () => {
    expect(isIndexLockError(
      "fatal: Unable to create '/home/me/proj/.git/index.lock': File exists.",
    )).toBe(true)
  })

  it('matches the Windows backslash form', () => {
    expect(isIndexLockError(
      "fatal: Unable to create 'C:\\Users\\me\\proj\\.git\\index.lock': File exists.",
    )).toBe(true)
  })

  it("matches a linked worktree's lock path", () => {
    expect(isIndexLockError(
      "fatal: Unable to create '/proj/.git/worktrees/feat/index.lock': File exists.",
    )).toBe(true)
  })

  it('matches an Error object, not just a string', () => {
    const e = new Error("fatal: Unable to create '/p/.git/index.lock': File exists.")
    expect(isIndexLockError(e)).toBe(true)
  })

  it('ignores unrelated failures', () => {
    expect(isIndexLockError('fatal: pathspec "nope" did not match any files')).toBe(false)
    expect(isIndexLockError("fatal: Unable to create '/p/.git/HEAD.lock': File exists.")).toBe(false)
    expect(isIndexLockError(undefined)).toBe(false)
  })
})

describe('GitService.removeIndexLock', () => {
  let tmpRepoPath: string
  let git: SimpleGit
  let service: GitService
  let lockPath: string

  beforeEach(async () => {
    tmpRepoPath = mkdtempSync(join(tmpdir(), 'git-gud-lock-'))
    git = simpleGit(tmpRepoPath)
    await git.init(['--initial-branch=main'])
    await git.addConfig('user.name', 'Tester')
    await git.addConfig('user.email', 'test@example.com')
    writeFileSync(join(tmpRepoPath, 'README.md'), '# Test Repo', 'utf-8')
    await git.add('README.md')
    await git.commit('Initial commit')
    service = new GitService(tmpRepoPath)
    lockPath = join(tmpRepoPath, '.git', 'index.lock')
  })

  afterEach(() => {
    rmSync(tmpRepoPath, { recursive: true, force: true })
  })

  it('surfaces a stale lock as an index-lock error and clears it for a retry', async () => {
    writeFileSync(join(tmpRepoPath, 'new.txt'), 'hello', 'utf-8')
    writeFileSync(lockPath, '', 'utf-8')

    // Staging must fail, and fail recognisably.
    let err: unknown
    await service.stage(['new.txt']).catch((e) => { err = e })
    expect(err).toBeDefined()
    expect(isIndexLockError(err)).toBe(true)

    const removed = await service.removeIndexLock()
    expect(removed.success).toBe(true)
    expect(removed.path).toBe(lockPath)
    expect(existsSync(lockPath)).toBe(false)

    // The retry the UI performs after the user confirms.
    await service.stage(['new.txt'])
    const status = await service.getStatus()
    expect(status.staged.map((f) => f.path)).toContain('new.txt')
  })

  it('treats an already-absent lock as success', async () => {
    expect(existsSync(lockPath)).toBe(false)
    const r = await service.removeIndexLock()
    expect(r.success).toBe(true)
  })

  it('resolves the lock inside the git dir of a linked worktree', async () => {
    const wtPath = join(tmpRepoPath, '..', `wt-${Date.now()}`)
    try {
      await git.raw(['worktree', 'add', '-b', 'feat', wtPath])
      const wtService = new GitService(wtPath)
      const wtLock = join(tmpRepoPath, '.git', 'worktrees', basename(wtPath), 'index.lock')
      writeFileSync(wtLock, '', 'utf-8')

      const r = await wtService.removeIndexLock()
      expect(r.success).toBe(true)
      expect(existsSync(wtLock)).toBe(false)
      // Never reaches for the main worktree's .git/index.lock.
      expect(r.path).toBe(wtLock)
    } finally {
      rmSync(wtPath, { recursive: true, force: true })
    }
  })
})
