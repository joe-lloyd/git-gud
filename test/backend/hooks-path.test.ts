import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitService } from '../../src/main/git-service'
import simpleGit, { SimpleGit } from 'simple-git'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// core.hooksPath pointing at a missing directory makes git silently run zero
// hooks. getStatus() surfaces that as `hooksPathBroken` for the commit UI.
describe('RepoStatus.hooksPathBroken', () => {
  let tmpRepoPath: string
  let git: SimpleGit
  let service: GitService

  beforeEach(async () => {
    tmpRepoPath = mkdtempSync(join(tmpdir(), 'git-gud-hooks-'))
    git = simpleGit(tmpRepoPath)
    await git.init(['--initial-branch=main'])
    await git.addConfig('user.name', 'Tester')
    await git.addConfig('user.email', 'test@example.com')
    service = new GitService(tmpRepoPath)
  })

  afterEach(() => {
    rmSync(tmpRepoPath, { recursive: true, force: true })
  })

  it('is undefined when core.hooksPath is unset', async () => {
    const status = await service.getStatus()
    expect(status.hooksPathBroken).toBeUndefined()
  })

  it('is undefined when core.hooksPath points at an existing directory', async () => {
    mkdirSync(join(tmpRepoPath, '.husky', '_'), { recursive: true })
    await git.addConfig('core.hooksPath', '.husky/_')
    const status = await service.getStatus()
    expect(status.hooksPathBroken).toBeUndefined()
  })

  it('reports a relative core.hooksPath whose directory is missing', async () => {
    // The husky fresh-worktree trap: `.husky/_` is gitignored and generated
    // by the prepare script, so a fresh worktree/clone doesn't have it.
    await git.addConfig('core.hooksPath', '.husky/_')
    const status = await service.getStatus()
    expect(status.hooksPathBroken).toBe('.husky/_')
  })

  it('reports an absolute core.hooksPath whose directory is missing', async () => {
    const missing = join(tmpRepoPath, 'nonexistent-hooks')
    await git.addConfig('core.hooksPath', missing)
    const status = await service.getStatus()
    expect(status.hooksPathBroken).toBe(missing)
  })
})
