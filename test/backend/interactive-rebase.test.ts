import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitService } from '../../src/main/git-service'
import simpleGit, { SimpleGit } from 'simple-git'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('GitService interactive rebase', () => {
  let repo: string
  let git: SimpleGit
  let service: GitService

  const commit = async (file: string, content: string, message: string): Promise<string> => {
    writeFileSync(join(repo, file), content, 'utf-8')
    await git.add(file)
    await git.commit(message)
    return (await git.revparse(['HEAD'])).trim()
  }
  const mainLog = async (): Promise<string[]> =>
    (await git.raw(['log', '--format=%s', 'main'])).trim().split('\n')
  const currentBranch = async (): Promise<string> => (await git.raw(['branch', '--show-current'])).trim()

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'gg-irebase-'))
    git = simpleGit(repo)
    await git.init()
    await git.addConfig('user.name', 'Tester')
    await git.addConfig('user.email', 'test@example.com')
    await commit('README.md', '# Test\n', 'initial')
    await git.raw(['branch', '-M', 'main'])
    service = new GitService(repo)
  })

  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it('lists only the current branch from the chosen commit, newest first', async () => {
    const a = await commit('a.txt', 'a\n', 'add a')
    await git.checkoutLocalBranch('side')
    await commit('side.txt', 'side\n', 'side work')
    await git.checkout('main')
    await commit('b.txt', 'b\n', 'add b')
    writeFileSync(join(repo, 'wip.txt'), 'wip\n')
    await git.raw(['stash', 'push', '--include-untracked', '-m', 'wip'])

    const r = await service.getRebaseCommits(a)
    expect(r.commits?.map((c) => c.message)).toEqual(['add b', 'add a'])
  })

  it('refuses a range with a merge in it', async () => {
    const a = await commit('a.txt', 'a\n', 'add a')
    await git.checkoutLocalBranch('side')
    await commit('side.txt', 'side\n', 'side work')
    await git.checkout('main')
    await git.raw(['merge', '--no-ff', 'side', '-m', 'merge side'])
    expect((await service.getRebaseCommits(a)).error).toMatch(/merge/)
  })

  it('applies reword, squash, drop and a new order on the branch you are on', async () => {
    const a = await commit('a.txt', 'a\n', 'add a')
    const b = await commit('b.txt', 'b\n', 'add b')
    const c = await commit('c.txt', 'c\n', 'add c')
    const d = await commit('d.txt', 'd\n', 'add d')
    const e = await commit('e.txt', 'e\n', 'add e')

    // Newest first, as the dialog shows it: e moves below d, d is dropped,
    // c is squashed into b, and a is reworded.
    const r = await service.interactiveRebase([
      { sha: d, action: 'drop' },
      { sha: e, action: 'pick' },
      { sha: c, action: 'squash' },
      { sha: b, action: 'pick' },
      { sha: a, action: 'reword', message: 'add a, reworded' },
    ])
    expect(r).toEqual({ success: true })
    expect(await currentBranch()).toBe('main')
    const log = await mainLog()
    expect(log[0]).toBe('add e')
    expect(log[2]).toBe('add a, reworded')
    expect(log[3]).toBe('initial')
    expect(log).toHaveLength(4)
    // The squashed commit carries both changes; the dropped one is gone.
    const files = (await git.raw(['ls-tree', '--name-only', 'main'])).trim().split('\n')
    expect(files.sort()).toEqual(['README.md', 'a.txt', 'b.txt', 'c.txt', 'e.txt'])
  })

  it('refuses to squash the oldest commit, before touching anything', async () => {
    const a = await commit('a.txt', 'a\n', 'add a')
    const b = await commit('b.txt', 'b\n', 'add b')
    const r = await service.interactiveRebase([{ sha: b, action: 'pick' }, { sha: a, action: 'squash' }])
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/oldest/)
    expect(await mainLog()).toEqual(['add b', 'add a', 'initial'])
  })

  it('stops mid-rebase on a conflict so the conflict panel can take over', async () => {
    const a = await commit('f.txt', 'one\n', 'first')
    const b = await commit('f.txt', 'two\n', 'second')
    // Reordering two edits of the same line conflicts.
    const r = await service.interactiveRebase([{ sha: a, action: 'pick' }, { sha: b, action: 'pick' }])
    expect(r.success).toBe(false)
    expect(r.conflict).toBe(true)
    expect((await service.getConflictState()).inRebase).toBe(true)
  })
})
