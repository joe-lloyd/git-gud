import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitService, GitActivity } from '../../src/main/git-service'
import simpleGit, { SimpleGit } from 'simple-git'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Index/HEAD probes behind the diff view legitimately fail for objects that
// don't exist (an untracked file has no index entry). Those records must be
// tagged `expected` so the activity console shows a warning, not a failure —
// while genuine failures stay untagged.
describe('GitActivity expected-failure tagging', () => {
  let tmpRepoPath: string
  let git: SimpleGit
  let service: GitService
  let activity: GitActivity[]

  // Activity records are emitted when the process's streams end, which can
  // trail the awaited command by a tick — settle before asserting.
  const settle = () => new Promise((r) => setTimeout(r, 50))

  beforeEach(async () => {
    tmpRepoPath = mkdtempSync(join(tmpdir(), 'git-gud-test-'))
    git = simpleGit(tmpRepoPath)
    await git.init(['--initial-branch=main'])
    await git.addConfig('user.name', 'Tester')
    await git.addConfig('user.email', 'test@example.com')
    writeFileSync(join(tmpRepoPath, 'README.md'), '# Test Repo', 'utf-8')
    await git.add('README.md')
    await git.commit('Initial commit')
    activity = []
    service = new GitService(tmpRepoPath, undefined, (rec) => activity.push(rec))
  })

  afterEach(() => {
    rmSync(tmpRepoPath, { recursive: true, force: true })
  })

  it('tags index probes for an untracked file as expected failures', async () => {
    writeFileSync(join(tmpRepoPath, 'new.bat'), '@echo off\n', 'utf-8')
    const res = await service.getFileDiffSources('new.bat', false)
    await settle()

    expect(res.oldText).toBe('')
    expect(res.newText).toContain('@echo off')

    // Both the size probe (cat-file -s) and the content probe (show).
    const probes = activity.filter((a) => a.args.join(' ').includes(':0:new.bat'))
    expect(probes.length).toBeGreaterThanOrEqual(2)
    for (const p of probes) {
      expect(p.failed).toBe(true)
      expect(p.expected).toBe(true)
    }
  })

  it('leaves successful probes unflagged as failures', async () => {
    const res = await service.getFileDiffSources('README.md', false)
    await settle()

    expect(res.oldText).toContain('# Test Repo')
    const probes = activity.filter((a) => a.args.join(' ').includes(':0:README.md'))
    expect(probes.length).toBeGreaterThanOrEqual(1)
    for (const p of probes) expect(p.failed).toBe(false)
  })

  it('leaves non-probe failures untagged', async () => {
    // A direct raw call is the control: same failure shape, no registration.
    const raw = (service as unknown as { git: { raw(a: string[]): Promise<string> } }).git
    await raw.raw(['show', 'HEAD:missing.txt']).catch(() => {})
    await settle()

    const rec = activity.find((a) => a.args.join(' ') === 'show HEAD:missing.txt')
    expect(rec).toBeDefined()
    expect(rec!.failed).toBe(true)
    expect(rec!.expected).toBeUndefined()
  })
})
