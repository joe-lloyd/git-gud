import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitService } from '../../src/main/git-service'
import simpleGit, { SimpleGit } from 'simple-git'
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// fastForwardBranch updates a non-checked-out local branch via
// `git fetch <remote> <branch>:<branch>` — working tree untouched,
// fast-forward only. Fixture: a bare "remote", a clone under test, and a
// second clone used to advance the remote out from under the first.
describe('GitService.fastForwardBranch', () => {
  let root: string
  let barePath: string
  let clonePath: string
  let otherPath: string
  let clone: SimpleGit
  let service: GitService

  const commitIn = async (git: SimpleGit, dir: string, file: string, msg: string) => {
    writeFileSync(join(dir, file), `${msg}\n`, 'utf-8')
    await git.add(file)
    await git.commit(msg)
  }

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'git-gud-ffb-')))
    barePath = join(root, 'remote.git')
    clonePath = join(root, 'clone')
    otherPath = join(root, 'other')

    await simpleGit(root).raw(['init', '--bare', '--initial-branch=main', barePath])

    await simpleGit(root).clone(barePath, otherPath)
    const other = simpleGit(otherPath)
    await other.addConfig('user.name', 'Other')
    await other.addConfig('user.email', 'other@example.com')
    await commitIn(other, otherPath, 'a.txt', 'initial commit')
    await other.push(['-u', 'origin', 'main'])

    await simpleGit(root).clone(barePath, clonePath)
    clone = simpleGit(clonePath)
    await clone.addConfig('user.name', 'Tester')
    await clone.addConfig('user.email', 'test@example.com')
    // Stand on a feature branch so main is free to be updated in place.
    await clone.checkoutLocalBranch('feature')
    service = new GitService(clonePath)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('fast-forwards a non-checked-out branch without touching the working tree', async () => {
    const other = simpleGit(otherPath)
    await commitIn(other, otherPath, 'b.txt', 'remote moved ahead')
    await other.push()
    const remoteTip = (await other.revparse(['HEAD'])).trim()

    // Dirty the working tree to prove the update never touches it.
    writeFileSync(join(clonePath, 'wip.txt'), 'uncommitted work\n', 'utf-8')

    const r = await service.fastForwardBranch('main')
    expect(r.success).toBe(true)
    expect((await clone.revparse(['main'])).trim()).toBe(remoteTip)
    expect((await clone.revparse(['--abbrev-ref', 'HEAD'])).trim()).toBe('feature')
    expect((await clone.status()).not_added).toContain('wip.txt')
  })

  it('refuses a diverged branch with kind not-ff', async () => {
    const other = simpleGit(otherPath)
    await commitIn(other, otherPath, 'b.txt', 'remote side')
    await other.push()
    // Diverge local main: add a commit the remote doesn't have.
    await clone.checkout('main')
    await commitIn(clone, clonePath, 'c.txt', 'local side')
    await clone.checkout('feature')

    const r = await service.fastForwardBranch('main')
    expect(r.success).toBe(false)
    expect(r.kind).toBe('not-ff')
    // Local main keeps its commit — nothing was force-moved.
    expect((await clone.raw(['log', '--oneline', 'main'])).includes('local side')).toBe(true)
  })

  it('reports a missing remote branch with kind no-remote-branch', async () => {
    await clone.raw(['branch', 'local-only', 'main'])
    const r = await service.fastForwardBranch('local-only')
    expect(r.success).toBe(false)
    expect(r.kind).toBe('no-remote-branch')
  })

  it('refuses the checked-out branch with kind checked-out', async () => {
    const other = simpleGit(otherPath)
    await commitIn(other, otherPath, 'b.txt', 'remote moved ahead')
    await other.push()
    await clone.checkout('main')

    const r = await service.fastForwardBranch('main')
    expect(r.success).toBe(false)
    expect(r.kind).toBe('checked-out')
  })

  it('follows a configured upstream on a differently-named remote branch', async () => {
    const other = simpleGit(otherPath)
    await other.checkoutLocalBranch('release/1.x')
    await commitIn(other, otherPath, 'r.txt', 'release work')
    await other.push(['-u', 'origin', 'release/1.x'])
    const remoteTip = (await other.revparse(['HEAD'])).trim()

    await clone.fetch()
    // Local name differs from the remote name — upstream config must win
    // over the origin/<same-name> fallback.
    await clone.raw(['branch', '--track', 'rel', 'origin/release/1.x'])
    await clone.raw(['branch', '-f', 'rel', 'main']) // rewind so there's something to fast-forward

    const r = await service.fastForwardBranch('rel')
    expect(r.success).toBe(true)
    expect((await clone.revparse(['rel'])).trim()).toBe(remoteTip)
  })
})
