import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitService, isMissingRemoteRef } from '../../src/main/git-service'
import simpleGit from 'simple-git'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Integration: deleting a remote branch that someone else already deleted must
// self-heal (prune the stale tracking ref) instead of surfacing git's
// "remote ref does not exist" push failure.

describe('GitService.deleteRemoteBranch', () => {
  let server: string
  let repo: string
  let other: string
  let service: GitService

  const commitIn = async (dir: string, name: string) => {
    const g = simpleGit(dir)
    writeFileSync(join(dir, `${name}.txt`), `${name}\n`)
    await g.add('.').then(() => g.commit(name))
  }

  const remoteRefs = async () =>
    (await simpleGit(repo).raw(['for-each-ref', '--format=%(refname)', 'refs/remotes']))
      .split('\n').map((l) => l.trim()).filter(Boolean)

  beforeEach(async () => {
    server = mkdtempSync(join(tmpdir(), 'del-server-'))
    repo = mkdtempSync(join(tmpdir(), 'del-repo-'))
    other = mkdtempSync(join(tmpdir(), 'del-other-'))

    await simpleGit(server).init(true)
    const g = simpleGit(repo)
    await g.init(['-b', 'main'] as any)
    await g.addConfig('user.name', 'T').then(() => g.addConfig('user.email', 't@t.t'))
    await commitIn(repo, 'base')
    await g.addRemote('origin', server)
    await g.push(['-u', 'origin', 'main'])
    await g.raw(['branch', 'doomed'])
    await g.push(['origin', 'doomed'])

    service = new GitService(repo)
  })

  afterEach(() => {
    for (const d of [server, repo, other]) rmSync(d, { recursive: true, force: true })
  })

  it('deletes a branch that really exists on the remote', async () => {
    const r = await service.deleteRemoteBranch('origin', 'doomed')
    expect(r.alreadyGone).toBe(false)
    expect(await remoteRefs()).not.toContain('refs/remotes/origin/doomed')
  })

  it('prunes the stale tracking ref when the remote branch is already gone', async () => {
    // Someone else deletes it; our clone never prunes, so the ghost ref stays.
    await simpleGit(other).clone(server, other)
    await simpleGit(other).push(['origin', '--delete', 'doomed'])
    expect(await remoteRefs()).toContain('refs/remotes/origin/doomed')

    const r = await service.deleteRemoteBranch('origin', 'doomed')

    expect(r.alreadyGone).toBe(true)
    expect(await remoteRefs()).not.toContain('refs/remotes/origin/doomed')
  })

  it('still throws on unrelated push failures', async () => {
    await expect(service.deleteRemoteBranch('nope', 'doomed')).rejects.toThrow()
  })

  it('reports an already-gone remote tag without touching the local tag', async () => {
    await simpleGit(repo).raw(['tag', 'v1'])
    await simpleGit(repo).raw(['push', 'origin', 'refs/tags/v1'])
    await simpleGit(other).clone(server, other)
    await simpleGit(other).push(['origin', '--delete', 'refs/tags/v1'])

    const r = await service.deleteRemoteTag('origin', 'v1')

    expect(r.alreadyGone).toBe(true)
    // The local tag is the user's own ref, not a tracking ref — it stays.
    expect((await simpleGit(repo).raw(['tag', '-l'])).trim()).toContain('v1')
  })

  it('deletes a remote tag that really exists', async () => {
    await simpleGit(repo).raw(['tag', 'v2'])
    await simpleGit(repo).raw(['push', 'origin', 'refs/tags/v2'])

    const r = await service.deleteRemoteTag('origin', 'v2')

    expect(r.alreadyGone).toBe(false)
    expect(await simpleGit(server).raw(['tag', '-l'])).not.toContain('v2')
  })

  it('deletes an annotated remote tag (peeled ls-remote line must not confuse it)', async () => {
    await simpleGit(repo).raw(['tag', '-a', 'v3', '-m', 'release'])
    await simpleGit(repo).raw(['push', 'origin', 'refs/tags/v3'])

    const r = await service.deleteRemoteTag('origin', 'v3')

    expect(r.alreadyGone).toBe(false)
    expect(await simpleGit(server).raw(['tag', '-l'])).not.toContain('v3')
  })

  it('does not treat a prefix-sharing tag as the one asked for', async () => {
    await simpleGit(repo).raw(['tag', 'v1.1'])
    await simpleGit(repo).raw(['push', 'origin', 'refs/tags/v1.1'])

    // v1 was never pushed; v1.1 must not stand in for it.
    const r = await service.deleteRemoteTag('origin', 'v1')

    expect(r.alreadyGone).toBe(true)
    expect(await simpleGit(server).raw(['tag', '-l'])).toContain('v1.1')
  })

  it('classifies only the missing-ref error', () => {
    expect(isMissingRemoteRef("error: unable to delete 'master': remote ref does not exist")).toBe(true)
    expect(isMissingRemoteRef('error: failed to push some refs')).toBe(false)
    expect(isMissingRemoteRef('fatal: Authentication failed')).toBe(false)
  })
})
