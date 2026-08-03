import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitService } from '../../src/main/git-service'
import simpleGit from 'simple-git'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Integration: syncGerritChangeRefs mirrors refs/changes/* from a remote into
// refs/gitgud/changes/<number>, prunes closed changes, and clearGerritChangeRefs
// removes the namespace. A local bare repo stands in for the Gerrit server.

describe('Gerrit change ref sync', () => {
  let serverPath: string
  let repoPath: string
  let service: GitService

  const refNames = async () =>
    (await simpleGit(repoPath).raw(['for-each-ref', '--format=%(refname)', 'refs/gitgud']))
      .trim().split('\n').filter(Boolean)

  beforeEach(async () => {
    serverPath = mkdtempSync(join(tmpdir(), 'gerrit-server-'))
    repoPath = mkdtempSync(join(tmpdir(), 'gerrit-client-'))

    await simpleGit(serverPath).init(true) // bare "Gerrit"
    const git = simpleGit(repoPath)
    await git.init(['-b', 'main'] as any)
    await git.addConfig('user.name', 'T').then(() => git.addConfig('user.email', 't@t.t'))
    writeFileSync(join(repoPath, 'a.txt'), 'a\n')
    await git.add('.').then(() => git.commit('base'))
    await git.addRemote('origin', serverPath)
    await git.push(['origin', 'HEAD:refs/heads/main'])

    // Two "open changes": patchset commits living only under refs/changes/*.
    for (const [n, ps] of [[1, 2], [7, 1]] as const) {
      writeFileSync(join(repoPath, `c${n}.txt`), `change ${n}\n`)
      await git.add('.').then(() => git.commit(`change ${n}`))
      await git.push(['origin', `HEAD:refs/changes/0${n}/${n}/${ps}`])
      await git.raw(['reset', '--hard', 'HEAD~1'])
    }

    service = new GitService(repoPath)
  })

  afterEach(() => {
    rmSync(serverPath, { recursive: true, force: true })
    rmSync(repoPath, { recursive: true, force: true })
  })

  it('fetches open changes into refs/gitgud/changes/<n> and prunes closed ones', async () => {
    const r1 = await service.syncGerritChangeRefs('origin', [
      { number: 1, currentRef: 'refs/changes/01/1/2' },
      { number: 7, currentRef: 'refs/changes/07/7/1' },
    ])
    expect(r1.success).toBe(true)
    expect((await refNames()).sort()).toEqual([
      'refs/gitgud/changes/1',
      'refs/gitgud/changes/7',
    ])

    // Change 7 closed → next sync prunes it, keeps 1.
    const r2 = await service.syncGerritChangeRefs('origin', [
      { number: 1, currentRef: 'refs/changes/01/1/2' },
    ])
    expect(r2.success).toBe(true)
    expect(r2.pruned).toBe(1)
    expect(await refNames()).toEqual(['refs/gitgud/changes/1'])

    // The mirrored commit is now walkable by log --all (graph node).
    const log = await service.getLog(50)
    expect(log.some((c) => c.refs.includes('refs/gitgud/changes/1'))).toBe(true)
  })

  it('clearGerritChangeRefs removes the whole namespace', async () => {
    await service.syncGerritChangeRefs('origin', [
      { number: 1, currentRef: 'refs/changes/01/1/2' },
    ])
    const removed = await service.clearGerritChangeRefs()
    expect(removed).toBe(1)
    expect(await refNames()).toEqual([])
  })

  it('an empty open set just prunes everything', async () => {
    await service.syncGerritChangeRefs('origin', [
      { number: 1, currentRef: 'refs/changes/01/1/2' },
    ])
    const r = await service.syncGerritChangeRefs('origin', [])
    expect(r.success).toBe(true)
    expect(r.pruned).toBe(1)
    expect(await refNames()).toEqual([])
  })
})
