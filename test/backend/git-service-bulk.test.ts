import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GitService } from '../../src/main/git-service'
import simpleGit, { SimpleGit } from 'simple-git'
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Integration tests for the multi-commit, worktree, streaming-commit and
// range-stat operations — the surface that regressed (silent no-ops) this session.

describe('GitService bulk / worktree / streaming', () => {
  let repo: string
  let wtRoot: string
  let git: SimpleGit
  let service: GitService

  // Subject lines on the current branch's history (HEAD ancestry only).
  const headMessages = async (): Promise<string[]> =>
    (await git.raw(['log', '--format=%s', 'HEAD'])).trim().split('\n').filter(Boolean)
  const headCount = async (): Promise<number> =>
    Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim())

  // Make `n` commits on the current branch; return their SHAs oldest→newest.
  const makeCommits = async (names: string[]): Promise<string[]> => {
    const shas: string[] = []
    for (const n of names) {
      writeFileSync(join(repo, `${n}.txt`), `${n} content\n`, 'utf-8')
      await git.add(`${n}.txt`)
      await git.commit(n)
      shas.push((await git.revparse(['HEAD'])).trim())
    }
    return shas
  }

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'gg-bulk-'))
    wtRoot = mkdtempSync(join(tmpdir(), 'gg-wt-'))
    git = simpleGit(repo)
    await git.init()
    await git.addConfig('user.name', 'Tester')
    await git.addConfig('user.email', 'test@example.com')
    writeFileSync(join(repo, 'README.md'), '# Test\n', 'utf-8')
    await git.add('README.md')
    await git.commit('initial')
    // Normalize the branch name regardless of the host's init.defaultBranch.
    await git.raw(['branch', '-M', 'main'])
    service = new GitService(repo)
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
    rmSync(wtRoot, { recursive: true, force: true })
  })

  // ── Squash / drop / cherry-pick / revert ─────────────────────────────────
  it('squashCommits combines a contiguous range into one commit', async () => {
    const [, b, c] = await makeCommits(['a', 'b', 'c', 'd'])
    const before = await headCount()

    const r = await service.squashCommits([b, c], 'squashed b+c')
    expect(r.success).toBe(true)

    expect(await headCount()).toBe(before - 1) // two commits became one
    const msgs = await headMessages()
    expect(msgs).toContain('squashed b+c')
    expect(msgs).toContain('d') // later commit preserved
  })

  it('rejects a non-contiguous squash selection', async () => {
    const [, b, , d] = await makeCommits(['a', 'b', 'c', 'd'])
    const before = await headCount()

    const r = await service.squashCommits([b, d], 'should fail') // gap at c
    expect(r.success).toBe(false)

    expect(await headCount()).toBe(before) // history unchanged
  })

  it('dropCommits removes a contiguous range', async () => {
    const [, b, c] = await makeCommits(['a', 'b', 'c', 'd'])
    const before = await headCount()

    const r = await service.dropCommits([b, c])
    expect(r.success).toBe(true)

    expect(await headCount()).toBe(before - 2)
    const msgs = await headMessages()
    expect(msgs).not.toContain('b')
    expect(msgs).not.toContain('c')
    expect(msgs).toContain('d') // later commit preserved
  })

  it('revertMany adds a revert commit per selected commit', async () => {
    const [a, b] = await makeCommits(['a', 'b'])
    const before = await headCount()

    const r = await service.revertMany([a, b])
    expect(r.success).toBe(true)

    expect(await headCount()).toBe(before + 2) // two revert commits
  })

  it('cherryPickMany applies commits onto the current branch', async () => {
    // Commit on a side branch, return to main, cherry-pick it over.
    await git.raw(['checkout', '-b', 'side'])
    const [picked] = await makeCommits(['picked'])
    await git.checkout('main')

    const r = await service.cherryPickMany([picked])
    expect(r.success).toBe(true)
    expect((await service.getLog(50)).some((l) => l.message === 'picked')).toBe(true)
  })

  // ── rangeStat ────────────────────────────────────────────────────────────
  it('rangeStat reports files/insertions for a range', async () => {
    const [a, , c] = await makeCommits(['a', 'b', 'c'])
    const stat = await service.rangeStat(a, c)
    expect(stat).not.toBeNull()
    expect(stat!.files).toBeGreaterThanOrEqual(3) // a.txt, b.txt, c.txt
    expect(stat!.insertions).toBeGreaterThan(0)
  })

  // ── Worktrees ──────────────────────────────────────────────────────────────
  it('addWorktree creates a new branch and lists the worktree', async () => {
    const wt = join(wtRoot, 'feature')
    const r = await service.addWorktree(wt, 'feature-x')
    expect(r.success).toBe(true)

    const trees = await service.getWorktrees()
    expect(trees.some((t) => t.branch === 'feature-x')).toBe(true)

    const branches = await service.getBranches()
    expect(branches.local.some((b) => b.name === 'feature-x')).toBe(true)
  })

  it('addWorktree surfaces a git error instead of silently succeeding', async () => {
    const wt = join(wtRoot, 'dup')
    expect((await service.addWorktree(wt, 'dupe')).success).toBe(true)
    // Re-using the same path must fail (not report success).
    const second = await service.addWorktree(wt, 'dupe2')
    expect(second.success).toBe(false)
    expect(second.error).toBeTruthy()
  })

  it('removeWorktree needs force when the worktree is dirty', async () => {
    const wt = join(wtRoot, 'dirty')
    await service.addWorktree(wt, 'dirty-branch')
    writeFileSync(join(wt, 'untracked.txt'), 'oops\n', 'utf-8') // make it dirty

    const plain = await service.removeWorktree(wt)
    expect(plain.success).toBe(false) // git refuses

    const forced = await service.removeWorktree(wt, true)
    expect(forced.success).toBe(true)
    expect((await service.getWorktrees()).some((t) => t.path === wt)).toBe(false)
  })

  // ── Streaming commit (hook output capture) ──────────────────────────────────
  const writeHook = (body: string) => {
    const hook = join(repo, '.git', 'hooks', 'pre-commit')
    writeFileSync(hook, `#!/bin/sh\n${body}\n`, 'utf-8')
    chmodSync(hook, 0o755)
  }

  it('commitStreaming strips ANSI and reports success + exit code', async () => {
    // Hook prints colored output and passes.
    writeHook("printf '\\033[31mhook ran\\033[0m\\n'\nexit 0")
    writeFileSync(join(repo, 'x.txt'), 'x\n', 'utf-8')
    await git.add('x.txt')

    let streamed = ''
    const res = await service.commitStreaming({ subject: 'with hook' }, (c) => { streamed += c.chunk })

    expect(res.success).toBe(true)
    expect(res.exitCode).toBe(0)
    expect(res.output).toContain('hook ran')
    expect(res.output).not.toContain('') // ANSI stripped
    expect(streamed).toContain('hook ran')
  })

  it('commitStreaming reports failure + non-zero exit when a hook aborts', async () => {
    writeHook("echo 'blocking commit'\nexit 1")
    writeFileSync(join(repo, 'y.txt'), 'y\n', 'utf-8')
    await git.add('y.txt')

    const res = await service.commitStreaming({ subject: 'blocked' }, () => {})

    expect(res.success).toBe(false)
    expect(res.exitCode).not.toBe(0)
    expect(res.output).toContain('blocking commit')
  })
})
