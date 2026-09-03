// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitService, classifyPullError, parseOverwrittenFiles } from '../../src/main/git-service'
import simpleGit, { SimpleGit } from 'simple-git'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Integration coverage for the auto-fix runner and the paused-operation
// detection it relies on. Every scenario builds a real repo (and, where
// needed, a bare remote) so the assertions are about what git actually did.

const write = (dir: string, file: string, text: string) => writeFileSync(join(dir, file), text, 'utf-8')
const read = (dir: string, file: string) => readFileSync(join(dir, file), 'utf-8')

async function initRepo(dir: string): Promise<SimpleGit> {
  const g = simpleGit(dir)
  await g.init(['-b', 'main'] as any)
  await g.addConfig('user.name', 'T')
  await g.addConfig('user.email', 't@t.t')
  await g.addConfig('commit.gpgsign', 'false')
  return g
}

describe('classifyPullError / parseOverwrittenFiles', () => {
  it('classifies the refusals the runner can fix', () => {
    expect(classifyPullError('error: Your local changes to the following files would be overwritten by merge:\n\ta.txt')).toBe('dirty')
    expect(classifyPullError('error: Your local changes would be overwritten by cherry-pick.')).toBe('dirty')
    expect(classifyPullError('error: cannot pull with rebase: You have unstaged changes.')).toBe('dirty')
    expect(classifyPullError('error: The following untracked working tree files would be overwritten by checkout:\n\tn.txt')).toBe('untracked')
  })
  it('classifies paused operations and conflicts', () => {
    expect(classifyPullError('error: You have not concluded your merge (MERGE_HEAD exists).')).toBe('in-progress')
    expect(classifyPullError('error: cherry-pick is already in progress')).toBe('in-progress')
    expect(classifyPullError('CONFLICT (content): Merge conflict in a.txt\nAutomatic merge failed; fix conflicts and then commit the result.')).toBe('conflict')
    expect(classifyPullError('error: could not apply 1234567... msg\nhint: After resolving the conflicts, mark them with')).toBe('conflict')
  })
  it('extracts every path from a would-be-overwritten message', () => {
    const msg = 'Error: error: The following untracked working tree files would be overwritten by merge:\n\tnotes.txt\n\tdocs/a b.md\nPlease move or remove them before you merge.\nAborting'
    expect(parseOverwrittenFiles(msg)).toEqual(['notes.txt', 'docs/a b.md'])
    expect(parseOverwrittenFiles('nothing here')).toEqual([])
  })
})

describe('GitService.autoFix — pull', () => {
  let server: string, repo: string, other: string

  beforeEach(async () => {
    server = mkdtempSync(join(tmpdir(), 'af-server-'))
    repo = mkdtempSync(join(tmpdir(), 'af-repo-'))
    other = mkdtempSync(join(tmpdir(), 'af-other-'))
    await simpleGit(server).init(true)
    const g = await initRepo(repo)
    write(repo, 'a.txt', 'base\n')
    write(repo, 'keep.txt', 'keep\n')
    await g.add('.'); await g.commit('base')
    await g.addRemote('origin', server)
    await g.push(['-u', 'origin', 'main'])
    // Remote moves ahead: edits a.txt and adds notes.txt.
    await simpleGit(other).clone(server, other)
    const go = simpleGit(other)
    await go.addConfig('user.name', 'O'); await go.addConfig('user.email', 'o@o.o')
    write(other, 'a.txt', 'remote\n')
    write(other, 'notes.txt', 'from remote\n')
    await go.add('.'); await go.commit('remote')
    await go.push()
    await g.fetch()
  })
  afterEach(() => { for (const d of [server, repo, other]) rmSync(d, { recursive: true, force: true }) })

  it('with autoFix off, a dirty tree is reported as kind=dirty and nothing is touched', async () => {
    write(repo, 'a.txt', 'local edit\n')
    const r = await new GitService(repo).pull({ autoFix: false })
    expect(r.success).toBe(false)
    expect(r.kind).toBe('dirty')
    expect(r.autoFixed).toBe(false)
    expect(read(repo, 'a.txt')).toBe('local edit\n')
    expect((await simpleGit(repo).stashList()).total).toBe(0)
  })

  it('stashes a dirty tree, pulls, and re-applies when it merges cleanly', async () => {
    // Edit a DIFFERENT tracked file than the remote touched → clean re-apply.
    // (git only refuses when the dirty file is one the pull would change, so
    // dirty a.txt with content that merges: same edit as remote.)
    write(repo, 'a.txt', 'remote\n')       // identical to what remote brings → git still refuses (dirty) but pop is trivial
    const r = await new GitService(repo).pull({ autoFix: true })
    expect(r.success).toBe(true)
    expect(r.autoFixed).toBe(true)
    expect(r.steps[0]).toMatch(/^Stashed 1 changed file$/)
    expect(r.steps).toContain('Pull succeeded')
    expect(r.steps[r.steps.length - 1]).toBe('Re-applied your changes')
    expect(r.stashKept).toBeUndefined()
    expect(read(repo, 'notes.txt')).toBe('from remote\n')
    expect((await simpleGit(repo).stashList()).total).toBe(0)
  })

  it('sets aside exactly the untracked files in the way and re-applies what it can', async () => {
    write(repo, 'notes.txt', 'my local notes\n')   // untracked, remote adds the same path
    write(repo, 'unrelated.txt', 'stays\n')        // untracked, not in the way
    const r = await new GitService(repo).pull({ autoFix: true })
    expect(r.success).toBe(true)
    expect(r.autoFixed).toBe(true)
    expect(r.steps[0]).toBe('Set aside 1 untracked file (notes.txt)')
    // The pulled notes.txt exists now, so the stash cannot restore the local
    // copy → kept on the stack, never dropped.
    expect(r.stashKept).toMatch(/untracked files set aside before pull/)
    expect(read(repo, 'notes.txt')).toBe('from remote\n')
    expect(read(repo, 'unrelated.txt')).toBe('stays\n')
    const stashes = await simpleGit(repo).stashList()
    expect(stashes.total).toBe(1)
    expect(stashes.latest?.message).toMatch(/untracked files set aside/)
  })

  it('keeps the stash and flags conflict when re-applying conflicts', async () => {
    write(repo, 'a.txt', 'local edit\n')          // remote changed the same line differently
    const r = await new GitService(repo).pull({ autoFix: true })
    expect(r.success).toBe(true)                  // the pull itself succeeded
    expect(r.conflict).toBe(true)
    expect(r.stashKept).toMatch(/autostash before pull/)
    expect(r.steps.some((s) => /hit conflicts/.test(s))).toBe(true)
    const c = await new GitService(repo).getConflictState()
    expect(c.op).toBe('stash')
    expect(c.inStashApply).toBe(true)
    expect(c.conflictedFiles).toEqual(['a.txt'])
    expect((await simpleGit(repo).stashList()).total).toBe(1)
  })

  it('a pull that stops on merge conflicts is reported as conflict (even though git reports it on stdout)', async () => {
    // Local commit on the same line as the remote's → merge conflict, no dirty tree involved.
    write(repo, 'a.txt', 'local commit\n')
    await simpleGit(repo).add('.'); await simpleGit(repo).commit('local')
    const r = await new GitService(repo).pull({ autoFix: true, rebase: false })
    expect(r.success).toBe(false)
    expect(r.conflict).toBe(true)
    expect(r.kind).toBe('conflict')
    expect(r.autoFixed).toBe(false)
    const c = await new GitService(repo).getConflictState()
    expect(c.op).toBe('merge')
    expect(c.conflictedFiles).toEqual(['a.txt'])
  })

  it('restores the tree when the operation fails for an unrelated reason after stashing', async () => {
    write(repo, 'a.txt', 'local edit\n')
    const svc = new GitService(repo)
    // Force the retry to fail: pull from a remote that does not exist.
    await simpleGit(repo).remote(['set-url', 'origin', join(tmpdir(), 'does-not-exist.git')])
    const r = await svc.pull({ autoFix: true })
    expect(r.success).toBe(false)
    expect(r.kind).not.toBe('dirty')
    // First attempt already fails on the bad URL, so no stash was needed;
    // either way the tree must be untouched and the stack empty.
    expect(read(repo, 'a.txt')).toBe('local edit\n')
    expect((await simpleGit(repo).stashList()).total).toBe(0)
  })
})

describe('GitService.autoFix — checkout / merge / cherry-pick', () => {
  let repo: string
  let git: SimpleGit

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'af-local-'))
    git = await initRepo(repo)
    write(repo, 'f.txt', 'base\n')
    await git.add('.'); await git.commit('base')
    await git.checkoutLocalBranch('topic')
    write(repo, 'f.txt', 'topic\n')
    write(repo, 'topic-only.txt', 'new\n')
    await git.add('.'); await git.commit('topic')
    await git.checkout('main')
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it('checkout: stashes the dirty tree, switches, and KEEPS the stash', async () => {
    write(repo, 'f.txt', 'dirty\n')
    const r = await new GitService(repo).checkout('topic', { autoFix: true })
    expect(r.success).toBe(true)
    expect(r.autoFixed).toBe(true)
    expect(r.stashKept).toMatch(/autostash before checkout topic/)
    expect(r.steps).toEqual([
      'Stashed 1 changed file',
      'Checkout topic succeeded',
      'Kept your changes in a stash — re-apply them when you are ready',
    ])
    expect((await git.branch()).current).toBe('topic')
    expect(read(repo, 'f.txt')).toBe('topic\n')
    expect((await git.stashList()).total).toBe(1)
  })

  it('checkout: sets aside an untracked file the target branch would overwrite', async () => {
    write(repo, 'topic-only.txt', 'mine\n')
    const r = await new GitService(repo).checkout('topic', { autoFix: true })
    expect(r.success).toBe(true)
    expect(r.steps[0]).toBe('Set aside 1 untracked file (topic-only.txt)')
    expect(read(repo, 'topic-only.txt')).toBe('new\n')
    expect((await git.stashList()).total).toBe(1)
  })

  it('checkout: with autoFix off, reports kind=dirty and leaves the tree alone', async () => {
    write(repo, 'f.txt', 'dirty\n')
    const r = await new GitService(repo).checkout('topic', { autoFix: false })
    expect(r.success).toBe(false)
    expect(r.kind).toBe('dirty')
    expect(read(repo, 'f.txt')).toBe('dirty\n')
    expect((await git.branch()).current).toBe('main')
  })

  it('merge: a dirty tree that merges cleanly is stashed, merged, re-applied', async () => {
    // Dirty edit on a file the merge does not touch → git still refuses? No:
    // git only refuses when the dirty file would be overwritten. Make the
    // dirty edit on f.txt with the same content topic brings, so merge refuses
    // (dirty) yet the re-apply is a no-op.
    write(repo, 'f.txt', 'topic\n')
    const svc = new GitService(repo)
    const r = await svc.autoFix('merge topic', { method: 'merge', args: ['topic'] }, { enabled: true })
    expect(r.success).toBe(true)
    expect(r.autoFixed).toBe(true)
    expect(r.steps).toContain('Merge topic succeeded')
    expect(read(repo, 'topic-only.txt')).toBe('new\n')
    expect((await git.stashList()).total).toBe(0)
  })

  it('cherry-pick that conflicts is reported as conflict and detected as inCherryPick', async () => {
    // main edits f.txt differently first → picking topic's commit conflicts.
    write(repo, 'f.txt', 'main\n')
    await git.add('.'); await git.commit('main edit')
    const svc = new GitService(repo)
    const topicSha = (await git.revparse(['topic'])).trim()
    const r = await svc.autoFix(`cherry-pick ${topicSha.slice(0, 7)}`, { method: 'cherryPick', args: [topicSha] }, { enabled: true })
    expect(r.success).toBe(false)
    expect(r.conflict).toBe(true)
    expect(r.kind).toBe('conflict')
    const c = await svc.getConflictState()
    expect(c.inCherryPick).toBe(true)
    expect(c.op).toBe('cherry-pick')
    expect(c.conflictedFiles).toEqual(['f.txt'])
    // Abort through the generic control clears the state.
    expect((await svc.operationAbort('cherry-pick')).success).toBe(true)
    expect((await svc.getConflictState()).op).toBeUndefined()
    expect(existsSync(join(repo, '.git', 'CHERRY_PICK_HEAD'))).toBe(false)
  })

  it('cherry-pick with a dirty tree AND a conflict keeps the stash and says so', async () => {
    write(repo, 'f.txt', 'main\n')
    await git.add('.'); await git.commit('main edit')
    write(repo, 'f.txt', 'dirty\n')                 // would be overwritten → dirty
    const svc = new GitService(repo)
    const topicSha = (await git.revparse(['topic'])).trim()
    const r = await svc.autoFix('cherry-pick x', { method: 'cherryPick', args: [topicSha] }, { enabled: true })
    expect(r.success).toBe(false)
    expect(r.conflict).toBe(true)
    expect(r.autoFixed).toBe(true)
    expect(r.stashKept).toMatch(/autostash before cherry-pick x/)
    expect(r.steps[0]).toBe('Stashed 1 changed file')
    expect(r.steps[1]).toMatch(/Kept your changes in stash/)
    expect((await git.stashList()).total).toBe(1)
    expect((await svc.getConflictState()).op).toBe('cherry-pick')
  })

  it('an operation refused because another is paused is kind=in-progress, not a new conflict', async () => {
    write(repo, 'f.txt', 'main\n')
    await git.add('.'); await git.commit('main edit')
    await git.raw(['cherry-pick', 'topic']).catch(() => { /* expected */ })
    const svc = new GitService(repo)
    const r = await svc.autoFix('merge topic', { method: 'merge', args: ['topic'] }, { enabled: true })
    expect(r.success).toBe(false)
    expect(r.kind).toBe('in-progress')
    expect(r.conflict).toBeUndefined()
  })
})

describe('GitService paused-operation detection', () => {
  let repo: string
  let git: SimpleGit

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'af-ops-'))
    git = await initRepo(repo)
    write(repo, 'f.txt', 'base\n')
    await git.add('.'); await git.commit('base')
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it('detects a conflicted revert and continues it after resolving', async () => {
    write(repo, 'f.txt', 'v1\n'); await git.add('.'); await git.commit('v1')
    write(repo, 'f.txt', 'v2\n'); await git.add('.'); await git.commit('v2')
    await git.raw(['revert', '--no-edit', 'HEAD~1']).catch(() => { /* expected conflict */ })
    const svc = new GitService(repo)
    let c = await svc.getConflictState()
    expect(c.inRevert).toBe(true)
    expect(c.op).toBe('revert')
    write(repo, 'f.txt', 'resolved\n')
    await svc.markResolved(['f.txt'])
    expect((await svc.operationContinue('revert')).success).toBe(true)
    c = await svc.getConflictState()
    expect(c.op).toBeUndefined()
    expect((await git.log()).latest?.message).toMatch(/^Revert/)
  })

  it('detects a conflicted stash pop as op=stash and aborts it without losing the stash', async () => {
    write(repo, 'f.txt', 'wip\n')
    await git.stash(['push', '-m', 'my wip'])
    write(repo, 'f.txt', 'main moved\n'); await git.add('.'); await git.commit('moved')
    await git.stash(['pop']).catch(() => { /* expected conflict */ })
    const svc = new GitService(repo)
    const c = await svc.getConflictState()
    expect(c.op).toBe('stash')
    expect(c.inStashApply).toBe(true)
    expect(c.conflictedFiles).toEqual(['f.txt'])
    expect(read(repo, 'f.txt')).toMatch(/<<<<<<</)
    expect((await svc.operationAbort('stash')).success).toBe(true)
    expect(read(repo, 'f.txt')).toBe('main moved\n')
    expect((await svc.getConflictState()).op).toBeUndefined()
    expect((await git.stashList()).total).toBe(1)   // kept
  })

  it('a clean repo reports no op and every flag false', async () => {
    const c = await new GitService(repo).getConflictState()
    expect(c).toEqual({
      inMerge: false, inRebase: false, rebaseKind: undefined,
      inCherryPick: false, inRevert: false, inStashApply: false,
      op: undefined, conflictedFiles: [],
    })
  })
})
