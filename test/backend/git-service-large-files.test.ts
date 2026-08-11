import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  GitService,
  SOURCE_MAX_BYTES,
  UNTRACKED_PREVIEW_MAX_BYTES,
} from '../../src/main/git-service'
import simpleGit, { SimpleGit } from 'simple-git'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Large-file guards: whole-file reads in the MAIN process are size-capped so
// a huge file can't OOM-abort the app. These tests pin the cap behaviour and
// the user-facing notices/overrides around it.
describe('GitService large-file guards', () => {
  let tmpRepoPath: string
  let git: SimpleGit
  let service: GitService

  beforeEach(async () => {
    tmpRepoPath = mkdtempSync(join(tmpdir(), 'git-gud-test-'))
    git = simpleGit(tmpRepoPath)
    await git.init(['--initial-branch=main'])
    await git.addConfig('user.name', 'Tester')
    await git.addConfig('user.email', 'test@example.com')
    writeFileSync(join(tmpRepoPath, 'README.md'), '# Test Repo', 'utf-8')
    await git.add('README.md')
    await git.commit('Initial commit')
    service = new GitService(tmpRepoPath)
  })

  afterEach(() => {
    rmSync(tmpRepoPath, { recursive: true, force: true })
  })

  it('small untracked file previews fully with no notice', async () => {
    writeFileSync(join(tmpRepoPath, 'new.txt'), 'line1\nline2\nline3', 'utf-8')
    const res = await service.getFileDiff('new.txt', false)
    expect(res.notice).toBeUndefined()
    expect(res.diff).toContain('+line1')
    expect(res.diff).toContain('+line3')
  })

  it('oversized untracked file is truncated with a loadable notice', async () => {
    const line = 'x'.repeat(99) + '\n' // 100 bytes per line
    const lines = Math.ceil((UNTRACKED_PREVIEW_MAX_BYTES * 1.5) / 100)
    writeFileSync(join(tmpRepoPath, 'big.txt'), line.repeat(lines), 'utf-8')

    const res = await service.getFileDiff('big.txt', false)
    expect(res.notice).toMatchObject({
      reason: 'untracked-large',
      truncated: true,
      canLoadFull: true,
    })
    expect(res.notice!.sizeBytes).toBe(lines * 100)
    // Preview holds roughly the cap (+ one "+" sign per line), not the whole file.
    expect(res.diff.length).toBeLessThan(UNTRACKED_PREVIEW_MAX_BYTES * 1.05)
    expect(res.diff.length).toBeLessThan(lines * 100)
    expect(res.diff).toContain('+xxx')
  })

  it('fullUntracked override loads the entire oversized file', async () => {
    const line = 'y'.repeat(99) + '\n'
    const lines = Math.ceil((UNTRACKED_PREVIEW_MAX_BYTES * 1.5) / 100)
    writeFileSync(join(tmpRepoPath, 'big.txt'), line.repeat(lines), 'utf-8')

    const res = await service.getFileDiff('big.txt', false, { fullUntracked: true })
    expect(res.notice).toMatchObject({ reason: 'untracked-large', truncated: false })
    // +1 sign per line, minus nothing: full content present.
    expect(res.diff.length).toBeGreaterThan(UNTRACKED_PREVIEW_MAX_BYTES)
  })

  it('untracked binary file yields no preview and a binary notice', async () => {
    const buf = Buffer.alloc(4096)
    buf.write('PNGish', 0)
    writeFileSync(join(tmpRepoPath, 'blob.bin'), buf)

    const res = await service.getFileDiff('blob.bin', false)
    expect(res.diff).toBe('')
    expect(res.notice).toMatchObject({ reason: 'untracked-binary', canLoadFull: false })
  })

  it('diff sources are withheld for files over the source cap', async () => {
    writeFileSync(join(tmpRepoPath, 'grow.txt'), 'small\n', 'utf-8')
    await git.add('grow.txt')
    await git.commit('add grow.txt')
    // Working-tree copy balloons past the cap — sources must be refused
    // WITHOUT reading the content.
    writeFileSync(join(tmpRepoPath, 'grow.txt'), 'z'.repeat(SOURCE_MAX_BYTES + 1), 'utf-8')

    const res = await service.getFileDiffSources('grow.txt', false)
    expect(res.oldText).toBe('')
    expect(res.newText).toBe('')
    expect(res.skipped).toMatchObject({ reason: 'too-large', limitBytes: SOURCE_MAX_BYTES })
    expect(res.skipped!.sizeBytes).toBe(SOURCE_MAX_BYTES + 1)
  })

  it('diff sources are withheld for binary content', async () => {
    const buf = Buffer.alloc(1024)
    buf.write('bin', 0)
    writeFileSync(join(tmpRepoPath, 'data.bin'), buf)
    await git.add('data.bin')
    await git.commit('add data.bin')
    writeFileSync(join(tmpRepoPath, 'data.bin'), Buffer.concat([buf, Buffer.from('more')]))

    const res = await service.getFileDiffSources('data.bin', false)
    expect(res.oldText).toBe('')
    expect(res.newText).toBe('')
    expect(res.skipped?.reason).toBe('binary')
  })

  it('normal tracked-file diff keeps working through the new result shape', async () => {
    writeFileSync(join(tmpRepoPath, 'README.md'), '# Test Repo\nchanged', 'utf-8')
    const res = await service.getFileDiff('README.md', false)
    expect(res.notice).toBeUndefined()
    expect(res.diff).toContain('+changed')

    const sources = await service.getFileDiffSources('README.md', false)
    expect(sources.skipped).toBeUndefined()
    expect(sources.oldText).toContain('# Test Repo')
    expect(sources.newText).toContain('changed')
  })
})
