import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  parseGitReview,
  urlLooksLikeGerrit,
  parseRemoteUrl,
  projectFromRemoteUrl,
  hostFromRemoteUrl,
  detectGerrit,
  buildReviewRefspec,
  classifyReviewPushError,
  stripXssiPrefix,
  mapGerritChange,
  cookieHeaderForHost,
  canonicalGerritRestHost,
  buildChangeRefFetchSpecs,
} from '../../src/main/gerrit-utils'

describe('parseGitReview', () => {
  it('parses the [gerrit] section', () => {
    const content = [
      '# review config',
      '[gerrit]',
      'host=review.example.org',
      'port=29418',
      'project=tools/git-gud.git',
      'defaultbranch=main',
    ].join('\n')
    expect(parseGitReview(content)).toEqual({
      host: 'review.example.org',
      port: '29418',
      project: 'tools/git-gud',
      defaultBranch: 'main',
    })
  })

  it('ignores keys outside the [gerrit] section', () => {
    const content = ['[other]', 'host=nope.example.org', '[gerrit]', 'host=yes.example.org'].join('\n')
    expect(parseGitReview(content).host).toBe('yes.example.org')
  })

  it('handles an empty file', () => {
    expect(parseGitReview('')).toEqual({
      host: undefined, port: undefined, project: undefined, defaultBranch: undefined,
    })
  })
})

describe('urlLooksLikeGerrit', () => {
  it.each([
    'ssh://jdoe@review.example.org:29418/tools/repo',
    'jdoe@gerrit.example.org:tools/repo.git',
    'https://gerrit.wikimedia.org/r/mediawiki/core',
    'https://example.org/gerrit/tools/repo',
    'https://review.example.org/a/tools/repo',
    // Google-hosted Gerrit and the review.* naming convention
    'https://myproject.googlesource.com/apps/frontend',
    'https://chromium.googlesource.com/chromium/src',
    'https://review.opendev.org/openstack/nova',
    'https://android-review.googlesource.com/platform/build',
  ])('matches %s', (url) => {
    expect(urlLooksLikeGerrit(url)).toBe(true)
  })

  it.each([
    'git@github.com:owner/repo.git',
    'https://gitlab.com/group/project.git',
    'ssh://git@bitbucket.org:7999/proj/repo.git',
    'https://example.org/owner/gerrit-tools-name', // "gerrit" only inside a segment name
  ])('does not match %s', (url) => {
    expect(urlLooksLikeGerrit(url)).toBe(false)
  })
})

describe('parseRemoteUrl / derivations', () => {
  it('parses ssh:// URLs with port', () => {
    expect(parseRemoteUrl('ssh://jdoe@review.example.org:29418/tools/repo')).toEqual({
      protocol: 'ssh', host: 'review.example.org', port: '29418', path: '/tools/repo',
    })
  })

  it('parses scp-like URLs', () => {
    expect(parseRemoteUrl('git@host.example.org:group/repo.git')).toEqual({
      protocol: 'ssh', host: 'host.example.org', port: undefined, path: '/group/repo.git',
    })
  })

  it('derives the project name, stripping /a/ and .git', () => {
    expect(projectFromRemoteUrl('https://review.example.org/a/tools/repo.git')).toBe('tools/repo')
    expect(projectFromRemoteUrl('ssh://jdoe@review.example.org:29418/tools/repo')).toBe('tools/repo')
  })

  it('derives an https host only from http(s) remotes', () => {
    expect(hostFromRemoteUrl('https://review.example.org/tools/repo')).toBe('https://review.example.org')
    expect(hostFromRemoteUrl('https://review.example.org:8443/tools/repo')).toBe('https://review.example.org:8443')
    expect(hostFromRemoteUrl('ssh://jdoe@review.example.org:29418/tools/repo')).toBeUndefined()
  })
})

describe('detectGerrit', () => {
  let repo: string

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'gerrit-detect-'))
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true })
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it('reports nothing for a plain GitHub repo', () => {
    const d = detectGerrit(repo, [{ name: 'origin', url: 'git@github.com:owner/repo.git' }])
    expect(d.likely).toBe(false)
    expect(d.signals).toEqual([])
  })

  it('flags .gitreview and harvests host/project/branch from it', () => {
    writeFileSync(
      join(repo, '.gitreview'),
      '[gerrit]\nhost=review.example.org\nproject=tools/repo\ndefaultbranch=stable',
    )
    const d = detectGerrit(repo, [{ name: 'origin', url: 'git@github.com:owner/repo.git' }])
    expect(d.likely).toBe(true)
    expect(d.signals).toContain('.gitreview')
    expect(d.host).toBe('https://review.example.org')
    expect(d.project).toBe('tools/repo')
    expect(d.defaultBranch).toBe('stable')
  })

  it('flags a Gerrit-looking remote URL and derives project/host from it', () => {
    const d = detectGerrit(repo, [
      { name: 'origin', url: 'https://review.example.org/a/tools/repo' },
    ])
    expect(d.likely).toBe(true)
    expect(d.signals).toContain('remote-url:origin')
    expect(d.remote).toBe('origin')
    expect(d.host).toBe('https://review.example.org')
    expect(d.project).toBe('tools/repo')
  })

  it('flags a commit-msg hook that inserts Change-Id', () => {
    writeFileSync(join(repo, '.git', 'hooks', 'commit-msg'), '#!/bin/sh\n# add Change-Id\n')
    const d = detectGerrit(repo, [{ name: 'origin', url: 'git@github.com:owner/repo.git' }])
    expect(d.likely).toBe(true)
    expect(d.signals).toContain('commit-msg-hook')
  })
})

describe('buildReviewRefspec', () => {
  const base = { remote: 'origin', targetBranch: 'main' }

  it('builds the bare refspec', () => {
    expect(buildReviewRefspec(base)).toBe('HEAD:refs/for/main')
  })

  it('appends single options', () => {
    expect(buildReviewRefspec({ ...base, wip: true })).toBe('HEAD:refs/for/main%wip')
    expect(buildReviewRefspec({ ...base, ready: true })).toBe('HEAD:refs/for/main%ready')
    expect(buildReviewRefspec({ ...base, private: true })).toBe('HEAD:refs/for/main%private')
    expect(buildReviewRefspec({ ...base, topic: 'login-fix' })).toBe('HEAD:refs/for/main%topic=login-fix')
  })

  it('joins multiple options with commas, topic first', () => {
    expect(buildReviewRefspec({ ...base, topic: 't1', wip: true, private: true })).toBe(
      'HEAD:refs/for/main%topic=t1,wip,private',
    )
  })

  it('ignores a blank topic and trims whitespace', () => {
    expect(buildReviewRefspec({ ...base, topic: '   ' })).toBe('HEAD:refs/for/main')
    expect(buildReviewRefspec({ ...base, topic: ' t ' })).toBe('HEAD:refs/for/main%topic=t')
  })

  it('targets other branches', () => {
    expect(buildReviewRefspec({ remote: 'gerrit', targetBranch: 'stable-3.9' })).toBe(
      'HEAD:refs/for/stable-3.9',
    )
  })
})

describe('classifyReviewPushError', () => {
  it('classifies missing Change-Id', () => {
    expect(
      classifyReviewPushError('remote: ERROR: commit 1234: missing Change-Id in message footer'),
    ).toBe('missing-change-id')
  })
  it('classifies no new changes', () => {
    expect(classifyReviewPushError('! [remote rejected] HEAD -> refs/for/main (no new changes)')).toBe(
      'no-new-changes',
    )
  })
  it('falls through to unknown', () => {
    expect(classifyReviewPushError('fatal: unable to access host')).toBe('unknown')
  })
})

describe('REST plumbing', () => {
  it('strips the XSSI prefix', () => {
    expect(stripXssiPrefix(")]}'\n[{\"a\":1}]")).toBe('[{"a":1}]')
    expect(stripXssiPrefix('[{"a":1}]')).toBe('[{"a":1}]')
  })

  it('maps a Gerrit change entry', () => {
    const change = mapGerritChange('https://review.example.org/', {
      change_id: 'I' + 'a'.repeat(40),
      _number: 4711,
      subject: 'Fix the thing',
      project: 'tools/repo',
      branch: 'main',
      updated: '2026-08-01 10:00:00.000000000',
      work_in_progress: true,
      owner: { display_name: 'Ann Author' },
      current_revision: 'deadbeef',
      revisions: {
        deadbeef: { _number: 3, ref: 'refs/changes/11/4711/3', created: '2026-08-01 10:00:00.000000000', kind: 'REWORK' },
        cafe0001: { _number: 1, created: '2026-07-28 09:00:00.000000000', kind: 'REWORK' },
        cafe0002: { _number: 2, created: '2026-07-30 09:00:00.000000000', kind: 'TRIVIAL_REBASE' },
      },
    })
    expect(change).toEqual({
      id: 'I' + 'a'.repeat(40),
      number: 4711,
      subject: 'Fix the thing',
      owner: 'Ann Author',
      branch: 'main',
      patchset: 3,
      wip: true,
      updated: '2026-08-01 10:00:00.000000000',
      url: 'https://review.example.org/c/tools%2Frepo/+/4711',
      currentSha: 'deadbeef',
      currentRef: 'refs/changes/11/4711/3',
      patchsets: [
        { sha: 'deadbeef', number: 3, created: '2026-08-01 10:00:00.000000000', kind: 'REWORK' },
        { sha: 'cafe0002', number: 2, created: '2026-07-30 09:00:00.000000000', kind: 'TRIVIAL_REBASE' },
        { sha: 'cafe0001', number: 1, created: '2026-07-28 09:00:00.000000000', kind: 'REWORK' },
      ],
    })
  })

  it('survives missing optional fields', () => {
    const change = mapGerritChange('https://review.example.org', { _number: 1, subject: 's' })
    expect(change.owner).toBe('unknown')
    expect(change.patchset).toBe(0)
    expect(change.wip).toBe(false)
    expect(change.patchsets).toEqual([])
  })
})

describe('canonicalGerritRestHost', () => {
  it('maps googlesource clone hosts to the -review host (REST lives there)', () => {
    expect(canonicalGerritRestHost('https://myproject.googlesource.com'))
      .toBe('https://myproject-review.googlesource.com')
    expect(canonicalGerritRestHost('https://chromium.googlesource.com/chromium/src'))
      .toBe('https://chromium-review.googlesource.com/chromium/src')
  })

  it('leaves -review hosts and non-googlesource hosts alone', () => {
    expect(canonicalGerritRestHost('https://android-review.googlesource.com'))
      .toBe('https://android-review.googlesource.com')
    expect(canonicalGerritRestHost('https://review.example.org'))
      .toBe('https://review.example.org')
    expect(canonicalGerritRestHost('')).toBe('')
  })

  it('does not rewrite lookalike domains', () => {
    expect(canonicalGerritRestHost('https://foo.googlesource.com.evil.net'))
      .toBe('https://foo.googlesource.com.evil.net')
  })
})

describe('buildChangeRefFetchSpecs', () => {
  it('builds force refspecs into refs/gitgud/changes/<number>', () => {
    expect(buildChangeRefFetchSpecs([
      { number: 1234, currentRef: 'refs/changes/34/1234/5' },
      { number: 7, currentRef: 'refs/changes/07/7/2' },
    ])).toEqual([
      '+refs/changes/34/1234/5:refs/gitgud/changes/1234',
      '+refs/changes/07/7/2:refs/gitgud/changes/7',
    ])
  })

  it('skips entries without a proper change ref', () => {
    expect(buildChangeRefFetchSpecs([
      { number: 1, currentRef: undefined },
      { number: 0, currentRef: 'refs/changes/01/1/1' },
      { number: 2, currentRef: 'refs/heads/main' },
    ])).toEqual([])
  })
})

describe('cookieHeaderForHost', () => {
  const NOW = 1_800_000_000_000 // fixed "now" (ms)
  const FILE = [
    '# Netscape HTTP Cookie File',
    '.googlesource.com\tTRUE\t/\tTRUE\t2147483647\to\tgit-user.example.com=1//abc',
    'other.example.org\tFALSE\t/\tTRUE\t2147483647\tsession\txyz',
    '#HttpOnly_.httponly.example.org\tTRUE\t/\tTRUE\t2147483647\tsecret\tvalue',
    '.expired.example.org\tTRUE\t/\tTRUE\t1000000000\told\tgone', // expired long ago
  ].join('\n')

  it('matches subdomains against a dot-prefixed cookie domain', () => {
    expect(cookieHeaderForHost(FILE, 'https://chromium.googlesource.com', NOW))
      .toBe('o=git-user.example.com=1//abc')
  })

  it('matches an exact host entry', () => {
    expect(cookieHeaderForHost(FILE, 'https://other.example.org', NOW)).toBe('session=xyz')
  })

  it('does not leak cookies to unrelated hosts', () => {
    expect(cookieHeaderForHost(FILE, 'https://evil-googlesource.com', NOW)).toBeUndefined()
    expect(cookieHeaderForHost(FILE, 'https://sub.other.example.org.evil.net', NOW)).toBeUndefined()
  })

  it('reads curl #HttpOnly_ lines', () => {
    expect(cookieHeaderForHost(FILE, 'https://www.httponly.example.org', NOW)).toBe('secret=value')
  })

  it('skips expired cookies', () => {
    expect(cookieHeaderForHost(FILE, 'https://www.expired.example.org', NOW)).toBeUndefined()
  })

  it('handles empty files and comments', () => {
    expect(cookieHeaderForHost('', 'https://any.example.org', NOW)).toBeUndefined()
    expect(cookieHeaderForHost('# just comments\n', 'https://any.example.org', NOW)).toBeUndefined()
  })
})
