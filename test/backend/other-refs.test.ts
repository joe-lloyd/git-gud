import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitService } from '../../src/main/git-service'
import simpleGit from 'simple-git'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Integration: tools that park commits in their own ref namespace (T3 Chat's
// refs/t3/checkpoints/*, refs/notes, jj scratch refs) must not leak into the
// graph. `log --all` walked them and every checkpoint showed up as an extra
// undecorated node; the walk is now namespace-scoped with an opt-in.

describe('tool-private ref namespaces', () => {
  let repoPath: string
  let service: GitService

  beforeEach(async () => {
    repoPath = mkdtempSync(join(tmpdir(), 'other-refs-'))
    const git = simpleGit(repoPath)
    await git.init(['-b', 'main'] as any)
    await git.addConfig('user.name', 'T')
    await git.addConfig('user.email', 't@t.t')

    writeFileSync(join(repoPath, 'a.txt'), 'a\n')
    await git.add('.')
    await git.commit('on main')

    // A checkpoint commit that exists ONLY under refs/t3/… — exactly what T3
    // Chat leaves behind: not on any branch, not tagged, unreachable otherwise.
    writeFileSync(join(repoPath, 'b.txt'), 'b\n')
    await git.add('.')
    await git.commit('t3 checkpoint')
    const checkpoint = (await git.revparse(['HEAD'])).trim()
    await git.raw(['update-ref', 'refs/t3/checkpoints/abc/turn/0', checkpoint])
    await git.raw(['reset', '--hard', 'HEAD~1'])

    service = new GitService(repoPath)
  })

  afterEach(() => rmSync(repoPath, { recursive: true, force: true }))

  it('keeps refs/t3 commits out of the graph by default', async () => {
    const messages = (await service.getLog(50)).map((c) => c.message)
    expect(messages).toContain('on main')
    expect(messages).not.toContain('t3 checkpoint')
  })

  it('includes and decorates them when asked', async () => {
    const log = await service.getLog(50, { includeOtherRefs: true })
    const checkpoint = log.find((c) => c.message === 't3 checkpoint')
    expect(checkpoint).toBeDefined()
    expect(checkpoint!.refs.join(',')).toContain('refs/t3/checkpoints/abc/turn/0')
  })

  it('reports the namespaces present so the toggle can name them', async () => {
    expect(await service.getOtherRefNamespaces()).toEqual([{ namespace: 'refs/t3', count: 1 }])
  })

  it('still shows branches, tags and remote-tracking refs', async () => {
    const git = simpleGit(repoPath)
    await git.raw(['tag', 'v1'])
    await git.raw(['branch', 'side'])
    await git.raw(['update-ref', 'refs/remotes/origin/main', 'HEAD'])

    const log = await service.getLog(50)
    const decoration = log.map((c) => c.refs.join(',')).join(' ')
    expect(decoration).toContain('tag: v1')
    expect(decoration).toContain('side')
    expect(decoration).toContain('origin/main')
    expect(await service.getOtherRefNamespaces()).toEqual([{ namespace: 'refs/t3', count: 1 }])
  })
})
