import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitService } from '../../src/main/git-service'
import simpleGit, { SimpleGit } from 'simple-git'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Conflict-state detection must work in normal repos AND linked worktrees
// (where .git is a file and the rebase/merge state lives under the main
// git-dir's worktrees/<name>/). This was the regression that hid the conflict
// takeover + resolver.

describe('GitService conflict detection', () => {
  let repo: string
  let wtRoot: string
  let git: SimpleGit

  // Two branches that conflict on the same file.
  const setupDivergingBranches = async () => {
    writeFileSync(join(repo, 'file.txt'), 'base\n', 'utf-8')
    await git.add('file.txt'); await git.commit('initial')
    await git.raw(['branch', '-M', 'main'])

    await git.raw(['checkout', '-b', 'topic'])
    writeFileSync(join(repo, 'file.txt'), 'topic\n', 'utf-8')
    await git.add('file.txt'); await git.commit('topic change')

    await git.checkout('main')
    writeFileSync(join(repo, 'file.txt'), 'main\n', 'utf-8')
    await git.add('file.txt'); await git.commit('main change')
  }

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'gg-conflict-'))
    wtRoot = mkdtempSync(join(tmpdir(), 'gg-conflict-wt-'))
    git = simpleGit(repo)
    await git.init()
    await git.addConfig('user.name', 'Tester')
    await git.addConfig('user.email', 'test@example.com')
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
    rmSync(wtRoot, { recursive: true, force: true })
  })

  it('reports no conflict state in a clean repo', async () => {
    writeFileSync(join(repo, 'file.txt'), 'base\n', 'utf-8')
    await git.add('file.txt'); await git.commit('initial')
    const c = (await new GitService(repo).getStatus()).conflict!
    expect(c.inMerge).toBe(false)
    expect(c.inRebase).toBe(false)
    expect(c.conflictedFiles).toEqual([])
  })

  it('detects a merge conflict in a normal repo', async () => {
    await setupDivergingBranches()
    // On main, merge topic → conflicts on file.txt.
    await git.raw(['merge', 'topic']).catch(() => { /* expected conflict */ })

    const c = (await new GitService(repo).getStatus()).conflict!
    expect(c.inMerge).toBe(true)
    expect(c.conflictedFiles).toContain('file.txt')
  })

  it('detects a rebase conflict INSIDE A WORKTREE (the regressed case)', async () => {
    await setupDivergingBranches()
    // Check out `topic` in a linked worktree and rebase it onto main → conflict.
    const wt = join(wtRoot, 'topic-wt')
    await git.raw(['worktree', 'add', wt, 'topic'])
    await simpleGit(wt).raw(['rebase', 'main']).catch(() => { /* expected conflict */ })

    // .git here is a FILE; the rebase state lives under the main git-dir.
    const c = (await new GitService(wt).getStatus()).conflict!
    expect(c.inRebase).toBe(true)
    expect(c.conflictedFiles).toContain('file.txt')
  })
})
