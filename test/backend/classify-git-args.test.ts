import { describe, it, expect } from 'vitest'
import { classifyGitArgs } from '../../src/main/git-service'

// The git-activity console hides `read` commands by default (routine refresh
// polling) and always shows `write` commands (mutations). Anything unknown
// must default to `write` so a new mutation is never silently hidden.

describe('classifyGitArgs', () => {
  it('classifies the refresh-polling commands as reads', () => {
    const reads: string[][] = [
      ['log', '--all', '--parents'],
      ['status', '--porcelain', '-b'],
      ['for-each-ref', '--format=%(refname)', 'refs/heads'],
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      ['stash', 'list', '--format=%H'],
      ['worktree', 'list', '--porcelain'],
      ['rev-list', '--left-right', '--count', 'main...@{u}'],
      ['diff', '--cached', '--numstat'],
      ['show', '-s', '--format=%P', 'abc123'],
      ['remote', '-v'],
      ['config', '--get', 'user.name'],
      ['rerere', 'status'],
      ['clean', '-n', '-d'],
      ['branch', '--list', 'feature'],
      ['tag'],
    ]
    for (const args of reads) {
      expect(classifyGitArgs(args), args.join(' ')).toBe('read')
    }
  })

  it('classifies mutations as writes', () => {
    const writes: string[][] = [
      ['commit', '-m', 'msg'],
      ['rebase', '--autostash', 'main'],
      ['reset', '--hard', 'abc123'],
      ['cherry-pick', 'abc123'],
      ['revert', '--no-edit', 'abc123'],
      ['merge', 'feature'],
      ['pull', '--rebase'],
      ['push', '-u', 'origin', 'main'],
      ['checkout', 'main'],
      ['stash', 'push', '--include-untracked'],
      ['branch', '-D', 'old'],
      ['tag', 'v1.0', 'abc123'],
      ['remote', 'add', 'origin', 'url'],
      ['clean', '-f', '-d'],
      ['config', 'user.name', 'Joe'],
      ['worktree', 'add', '/tmp/wt', 'branch'],
    ]
    for (const args of writes) {
      expect(classifyGitArgs(args), args.join(' ')).toBe('write')
    }
  })

  it('sees through leading -c / -C global flags to the real subcommand', () => {
    expect(classifyGitArgs(['-c', 'http.x.extraheader=…', 'push'])).toBe('write')
    expect(classifyGitArgs(['-c', 'a=b', '-c', 'c=d', 'fetch'])).toBe('write')
    expect(classifyGitArgs(['-C', '/repo', 'status'])).toBe('read')
    expect(classifyGitArgs(['-c', 'a=b', 'log', '--all'])).toBe('read')
  })

  it('defaults unknown commands to write (never hide a possible mutation)', () => {
    expect(classifyGitArgs(['frobnicate'])).toBe('write')
    expect(classifyGitArgs([])).toBe('write')
  })
})
