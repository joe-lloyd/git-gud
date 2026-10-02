// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import simpleGit from 'simple-git'
import { GitService } from '../../src/main/git-service'

// getCommitFiles: the companion's commit drawer and the desktop commit view.
describe('GitService.getCommitFiles', () => {
  let repo: string
  let root: string, second: string
  beforeAll(async () => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'gg-cfiles-')))
    const g = simpleGit(repo)
    await g.init(['-b', 'main'] as any); await g.addConfig('user.name', 'T'); await g.addConfig('user.email', 't@t.t')
    writeFileSync(join(repo, 'a.txt'), 'a\n'); writeFileSync(join(repo, 'b.txt'), 'b\n')
    await g.add('.'); await g.commit('root')
    root = (await g.revparse(['HEAD'])).trim()
    writeFileSync(join(repo, 'a.txt'), 'a2\n'); await g.add('.'); await g.commit('second')
    second = (await g.revparse(['HEAD'])).trim()
  })
  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  it('lists the files of a root commit (diff-tree needs --root)', async () => {
    const files = await new GitService(repo).getCommitFiles(root)
    expect(files).toEqual([{ path: 'a.txt', status: 'A' }, { path: 'b.txt', status: 'A' }])
  })

  it('still lists a normal commit against its parent', async () => {
    expect(await new GitService(repo).getCommitFiles(second)).toEqual([{ path: 'a.txt', status: 'M' }])
  })
})
