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
    // Change 1 has an older patchset (ps1) that was amended into ps2.
    for (const [n, ps] of [[1, 1], [1, 2], [7, 1]] as const) {
      writeFileSync(join(repoPath, `c${n}.txt`), `change ${n} ps ${ps}\n`)
      await git.add('.').then(() => git.commit(`change ${n} ps ${ps}`))
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

  // External Gerrit tooling sometimes fetches refs/changes/* into
  // refs/remotes/<remote>/changes/<nn>/<n>/<ps|meta>. The meta side is NoteDb
  // bookkeeping (root-parented "Update patch set" chains) that must not render
  // as history; the numbered side duplicates the gitgud mirror's pill.
  it('gerrit mode hides remote-tracking change/meta refs from log and branches', async () => {
    const git = simpleGit(repoPath)
    await service.syncGerritChangeRefs('origin', [
      { number: 1, currentRef: 'refs/changes/01/1/2' },
    ])
    const patchsetSha = (await git.raw(['rev-parse', 'refs/gitgud/changes/1'])).trim()

    // Simulate the pollution: a root NoteDb meta commit + a duplicate
    // numbered patchset ref, both under refs/remotes.
    const tree = (await git.raw(['rev-parse', 'HEAD^{tree}'])).trim()
    const metaSha = (await git.raw(['commit-tree', tree, '-m', 'Update patch set 1'])).trim()
    await git.raw(['update-ref', 'refs/remotes/origin/changes/01/1/meta', metaSha])
    await git.raw(['update-ref', 'refs/remotes/origin/changes/01/1/2', patchsetSha])

    // Gerrit mode off: existing behavior — the refs are walked and listed.
    let log = await service.getLog(50)
    expect(log.some((c) => c.sha === metaSha)).toBe(true)
    let branches = await service.getBranches()
    expect(branches.remote.some((b) => b.name === 'origin/changes/01/1/meta')).toBe(true)

    // Gerrit mode on: meta commit gone, duplicate pill gone, gitgud node kept.
    await git.addConfig('gitgud.gerrit.enabled', 'true')
    log = await service.getLog(50)
    expect(log.some((c) => c.sha === metaSha)).toBe(false)
    const changeNode = log.find((c) => c.sha === patchsetSha)
    expect(changeNode).toBeDefined()
    expect(changeNode!.refs).toContain('refs/gitgud/changes/1')
    expect(changeNode!.refs.some((r) => r.includes('origin/changes/'))).toBe(false)
    branches = await service.getBranches()
    expect(branches.remote.some((b) => b.name.includes('changes/01/1'))).toBe(false)
  })

  it('clearGerritChangeRefs removes the whole namespace', async () => {
    await service.syncGerritChangeRefs('origin', [
      { number: 1, currentRef: 'refs/changes/01/1/2' },
    ])
    const removed = await service.clearGerritChangeRefs()
    expect(removed).toBe(1)
    expect(await refNames()).toEqual([])
  })

  // "All patch sets" graph mode: older patchsets are mirrored alongside the
  // current one but only walked when asked for, so the default tree still
  // shows one node per change.
  it('mirrors older patchsets and walks them only with includeGerritPatchsets', async () => {
    const git = simpleGit(repoPath)
    await git.addConfig('gitgud.gerrit.enabled', 'true')
    const r = await service.syncGerritChangeRefs('origin', [
      { number: 1, currentRef: 'refs/changes/01/1/2', patchsets: [{ number: 2 }, { number: 1 }] },
      { number: 7, currentRef: 'refs/changes/07/7/1', patchsets: [{ number: 1 }] },
    ])
    expect(r.success).toBe(true)
    expect((await refNames()).sort()).toEqual([
      'refs/gitgud/changes/1',
      'refs/gitgud/changes/7',
      'refs/gitgud/patchsets/1/1',
    ])
    const ps1 = (await git.raw(['rev-parse', 'refs/gitgud/patchsets/1/1'])).trim()
    const ps2 = (await git.raw(['rev-parse', 'refs/gitgud/changes/1'])).trim()

    // Default: only the current patchset is a node.
    let log = await service.getLog(50)
    expect(log.some((c) => c.sha === ps2)).toBe(true)
    expect(log.some((c) => c.sha === ps1)).toBe(false)

    // All patch sets: the older one appears, decorated with its mirror ref.
    log = await service.getLog(50, { includeGerritPatchsets: true })
    const older = log.find((c) => c.sha === ps1)
    expect(older).toBeDefined()
    expect(older!.refs).toContain('refs/gitgud/patchsets/1/1')

    // Other refs on: --all must not leak the patchsets namespace unasked.
    log = await service.getLog(50, { includeOtherRefs: true })
    expect(log.some((c) => c.sha === ps1)).toBe(false)
    log = await service.getLog(50, { includeOtherRefs: true, includeGerritPatchsets: true })
    expect(log.some((c) => c.sha === ps1)).toBe(true)

    // A new current patchset demotes the old one into the patchsets namespace
    // and the mirrors of a closed change go away — both via prune + fetch.
    const r2 = await service.syncGerritChangeRefs('origin', [
      { number: 1, currentRef: 'refs/changes/01/1/2', patchsets: [{ number: 2 }] },
    ])
    expect(r2.success).toBe(true)
    expect(r2.pruned).toBe(2) // changes/7 + patchsets/1/1
    expect(await refNames()).toEqual(['refs/gitgud/changes/1'])

    // clear drops both namespaces.
    await service.syncGerritChangeRefs('origin', [
      { number: 1, currentRef: 'refs/changes/01/1/2', patchsets: [{ number: 2 }, { number: 1 }] },
    ])
    expect(await service.clearGerritChangeRefs()).toBe(2)
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
