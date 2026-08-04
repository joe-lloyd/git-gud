import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitService } from '../../src/main/git-service'
import simpleGit, { SimpleGit } from 'simple-git'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('GitService Integration Tests', () => {
  let tmpRepoPath: string
  let git: SimpleGit
  let service: GitService

  beforeEach(async () => {
    // Create a physical temporary directory for testing actual Git integration
    tmpRepoPath = mkdtempSync(join(tmpdir(), 'git-gud-test-'))
    git = simpleGit(tmpRepoPath)
    // Pin the initial branch — tests reference 'main' and must not depend on
    // the machine's init.defaultBranch (often 'master').
    await git.init(['--initial-branch=main'])
    
    // Configure local dummy user to allow commits
    await git.addConfig('user.name', 'Tester')
    await git.addConfig('user.email', 'test@example.com')

    // Create an initial commit to branch off from
    const dummyFile = join(tmpRepoPath, 'README.md')
    writeFileSync(dummyFile, '# Test Repo', 'utf-8')
    await git.add('README.md')
    await git.commit('Initial commit')

    service = new GitService(tmpRepoPath)
  })

  afterEach(() => {
    // Cleanup temporary repo directory completely
    rmSync(tmpRepoPath, { recursive: true, force: true })
  })

  it('should verify the repository is initialized correctly', async () => {
    const isRepo = await service.isRepo()
    expect(isRepo).toBe(true)
    
    const logs = await service.getLog()
    expect(logs.length).toBe(1)
    expect(logs[0].message).toBe('Initial commit')
  })

  it('should create a branch properly via createBranch', async () => {
    // ACT: Create a branch
    await service.createBranch('feature/test-branch')
    
    // ASSERT: Verify branch exists
    const branches = await service.getBranches()
    const targetBranch = branches.local.find(b => b.name === 'feature/test-branch')
    expect(targetBranch).toBeDefined()
    expect(targetBranch?.current).toBe(true) // checkoutLocalBranch makes it the current branch by default
  })

  it('should checkout an existing branch properly', async () => {
    await service.createBranch('secondary-branch')
    await git.checkout('main') // Switch away mechanically

    // ACT: Check it out
    const result = await service.checkout('secondary-branch')

    // ASSERT: Verify the switch
    expect(result.success).toBe(true)
    const branches = await service.getBranches()
    const current = branches.local.find(b => b.current)
    expect(current?.name).toBe('secondary-branch')
  })

  it('should stage files properly', async () => {
    // Setup another file
    const file2 = join(tmpRepoPath, 'setup.txt')
    writeFileSync(file2, 'hello', 'utf-8')

    // ACT
    await service.stage(['setup.txt'])

    // ASSERT
    const status = await service.getStatus()
    expect(status.staged.some(f => f.path === 'setup.txt')).toBe(true)
  })

  it('should commit files properly', async () => {
    const file3 = join(tmpRepoPath, 'final.txt')
    writeFileSync(file3, 'world', 'utf-8')
    await service.stage(['final.txt'])

    // ACT
    const result = await service.commit({ subject: 'Add final text' })

    // ASSERT
    expect(result.success).toBe(true)
    const logs = await service.getLog()
    expect(logs.length).toBe(2)
    expect(logs[0].message).toBe('Add final text')
  })

  it('should handle merge without errors', async () => {
    await service.createBranch('feature-a')
    writeFileSync(join(tmpRepoPath, 'feature.txt'), 'feature code')
    await service.stage(['feature.txt'])
    await service.commit({ subject: 'feature commit' })

    await service.checkout('main') // Back to main
    
    // ACT
    await service.merge('feature-a')

    // ASSERT
    const logs = await service.getLog(10)
    // The top commit should be the feature commit since it’s a fast-forward merge
    expect(logs[0].message).toBe('feature commit')
  })

  describe('renameTag', () => {
    it('renames a lightweight tag, keeping its target', async () => {
      const sha = (await git.revparse(['HEAD'])).trim()
      await service.createTag('v1', sha)

      await service.renameTag('v1', 'v1-final')

      const tags = await git.tags()
      expect(tags.all).toContain('v1-final')
      expect(tags.all).not.toContain('v1')
      expect((await git.revparse(['v1-final^{}'])).trim()).toBe(sha)
      // Stays lightweight — ref points straight at the commit, no tag object.
      expect((await git.raw(['tag', '-l', '--format=%(objecttype)', 'v1-final'])).trim()).toBe('commit')
    })

    it('renames an annotated tag, preserving target and message', async () => {
      const sha = (await git.revparse(['HEAD'])).trim()
      await git.raw(['tag', '-a', 'rel', sha, '-m', 'Release one\n\nWith a body line.'])

      await service.renameTag('rel', 'rel-1')

      const tags = await git.tags()
      expect(tags.all).toContain('rel-1')
      expect(tags.all).not.toContain('rel')
      expect((await git.revparse(['rel-1^{}'])).trim()).toBe(sha)
      expect((await git.raw(['tag', '-l', '--format=%(objecttype)', 'rel-1'])).trim()).toBe('tag')
      const subject = (await git.raw(['tag', '-l', '--format=%(contents:subject)', 'rel-1'])).trim()
      const body = (await git.raw(['tag', '-l', '--format=%(contents:body)', 'rel-1'])).trim()
      expect(subject).toBe('Release one')
      expect(body).toBe('With a body line.')
    })

    it('rejects renaming a tag that does not exist', async () => {
      await expect(service.renameTag('nope', 'still-nope')).rejects.toThrow(/not found/)
    })

    it('keeps the old tag when the new name already exists', async () => {
      const sha = (await git.revparse(['HEAD'])).trim()
      await service.createTag('a', sha)
      await service.createTag('b', sha)

      await expect(service.renameTag('a', 'b')).rejects.toThrow()

      const tags = await git.tags()
      expect(tags.all).toContain('a') // create-before-delete left it intact
      expect(tags.all).toContain('b')
    })
  })
})
