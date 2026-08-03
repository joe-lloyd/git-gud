import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitService } from '../../src/main/git-service'
import simpleGit from 'simple-git'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Integration: pull --ff-only against a diverged remote must fail with the
// 'not-ff' kind (targeted toast) instead of a generic error.

describe('GitService.pull ff-only', () => {
  let server: string
  let repo: string
  let other: string
  let service: GitService

  const commitIn = async (dir: string, name: string) => {
    const g = simpleGit(dir)
    writeFileSync(join(dir, `${name}.txt`), `${name}\n`)
    await g.add('.').then(() => g.commit(name))
  }

  beforeEach(async () => {
    server = mkdtempSync(join(tmpdir(), 'ff-server-'))
    repo = mkdtempSync(join(tmpdir(), 'ff-repo-'))
    other = mkdtempSync(join(tmpdir(), 'ff-other-'))

    await simpleGit(server).init(true)
    const g = simpleGit(repo)
    await g.init(['-b', 'main'] as any)
    await g.addConfig('user.name', 'T').then(() => g.addConfig('user.email', 't@t.t'))
    await commitIn(repo, 'base')
    await g.addRemote('origin', server)
    await g.push(['-u', 'origin', 'main'])

    // Diverge: a commit on the remote (via a second clone) + a local commit.
    await simpleGit(other).clone(server, other)
    const go = simpleGit(other)
    await go.addConfig('user.name', 'O').then(() => go.addConfig('user.email', 'o@o.o'))
    await commitIn(other, 'remote-side')
    await go.push(['origin', 'main'])
    await commitIn(repo, 'local-side')

    service = new GitService(repo)
  })

  afterEach(() => {
    for (const d of [server, repo, other]) rmSync(d, { recursive: true, force: true })
  })

  it('classifies a refused fast-forward as not-ff', async () => {
    const r = await service.pull({ ffOnly: true })
    expect(r.success).toBe(false)
    expect(r.kind).toBe('not-ff')
  })

  it('fast-forwards cleanly when the local branch is strictly behind', async () => {
    await simpleGit(repo).raw(['reset', '--hard', 'HEAD~1']) // drop local-side
    const r = await service.pull({ ffOnly: true })
    expect(r.success).toBe(true)
  })
})
