import { describe, it, expect } from 'vitest'
import {
  methodAccess,
  refusalMessage,
  makePeerRepoPath,
  parsePeerRepoPath,
  isPeerRepoPath,
  parseHostPort,
  encodeBeacon,
  parseBeacon,
  SseParser,
  encodeSseEvent,
  PairRateLimiter,
  generatePairingCode,
  hashToken,
  safeEqual,
  rpcActivityKind,
  READ_METHODS,
  SYNC_METHODS,
  RESULT_SHAPED_METHODS,
} from '../../src/main/peer-protocol'

describe('peer-protocol: method access', () => {
  it('serves reads, gates sync ops, denies everything else', () => {
    expect(methodAccess('getLog')).toBe('read')
    expect(methodAccess('getStatus')).toBe('read')
    expect(methodAccess('pull')).toBe('sync')
    expect(methodAccess('push')).toBe('sync')
    expect(methodAccess('fetch')).toBe('sync')
    for (const m of ['reset', 'commit', 'commitStreaming', 'stage', 'rebaseTo', 'clean', 'squashCommits', 'writeFileContent', 'setConfig']) {
      expect(methodAccess(m), m).toBe('denied')
    }
  })

  it('never lets a method be both read and sync', () => {
    for (const m of READ_METHODS) expect(SYNC_METHODS.has(m), m).toBe(false)
  })

  it('result-shaped methods that are denied are never reads', () => {
    for (const m of RESULT_SHAPED_METHODS) expect(READ_METHODS.has(m), m).toBe(false)
  })

  it('explains refusals differently for read-only shares', () => {
    expect(refusalMessage('pull', true)).toMatch(/read-only/)
    expect(refusalMessage('pull', false)).toMatch(/isn't available on a remote repository/)
    expect(refusalMessage('reset', true)).toMatch(/isn't available/) // reset is denied regardless
  })

  it('classifies console activity for mirrored RPCs', () => {
    expect(rpcActivityKind('getLog')).toBe('read')
    expect(rpcActivityKind('pull')).toBe('write')
  })
})

describe('peer-protocol: peer repo URIs', () => {
  it('round-trips POSIX paths', () => {
    const uri = makePeerRepoPath('abcd1234', '/Users/joe/Projects/app')
    expect(uri).toBe('gitgud-peer://abcd1234/Users/joe/Projects/app')
    expect(isPeerRepoPath(uri)).toBe(true)
    expect(parsePeerRepoPath(uri)).toEqual({ peerId: 'abcd1234', remotePath: '/Users/joe/Projects/app' })
  })

  it('round-trips Windows paths and normalizes backslashes', () => {
    const uri = makePeerRepoPath('abcd1234', 'C:\\Users\\joe\\proj')
    expect(uri).toBe('gitgud-peer://abcd1234/C:/Users/joe/proj')
    expect(parsePeerRepoPath(uri)).toEqual({ peerId: 'abcd1234', remotePath: 'C:/Users/joe/proj' })
  })

  it('keeps the folder name as the last segment (what tabs display)', () => {
    const uri = makePeerRepoPath('id', 'D:\\code\\git-gud')
    expect(uri.split(/[/\\]/).filter(Boolean).pop()).toBe('git-gud')
  })

  it('rejects non-peer and malformed inputs', () => {
    expect(isPeerRepoPath('/Users/joe/app')).toBe(false)
    expect(isPeerRepoPath(null)).toBe(false)
    expect(parsePeerRepoPath('gitgud-peer://')).toBeNull()
    expect(parsePeerRepoPath('gitgud-peer://onlyid')).toBeNull()
    expect(parsePeerRepoPath('gitgud-peer://id/')).toBeNull()
    expect(parsePeerRepoPath('/local')).toBeNull()
  })
})

describe('peer-protocol: host:port parsing', () => {
  it('defaults the port', () => {
    expect(parseHostPort('192.168.1.20')).toEqual({ host: '192.168.1.20', port: 47831 })
    expect(parseHostPort('my-pc.local')).toEqual({ host: 'my-pc.local', port: 47831 })
  })
  it('accepts explicit ports, urls and IPv6 brackets', () => {
    expect(parseHostPort('10.0.0.5:47835')).toEqual({ host: '10.0.0.5', port: 47835 })
    expect(parseHostPort('http://box:47831/')).toEqual({ host: 'box', port: 47831 })
    expect(parseHostPort('[fe80::1]:5000')).toEqual({ host: 'fe80::1', port: 5000 })
    expect(parseHostPort('[fe80::1]')).toEqual({ host: 'fe80::1', port: 47831 })
  })
  it('rejects garbage', () => {
    expect(parseHostPort('')).toBeNull()
    expect(parseHostPort('a:b:c')).toBeNull()
    expect(parseHostPort('host:99999')).toBeNull()
    expect(parseHostPort(':47831')).toBeNull()
  })
})

describe('peer-protocol: discovery beacon', () => {
  it('round-trips', () => {
    const buf = encodeBeacon({ peerId: 'deadbeefcafe', name: 'Joe’s Mac', port: 47831, version: '1.10.0' })
    expect(parseBeacon(buf)).toEqual({ t: 'gitgud-peer', v: 1, peerId: 'deadbeefcafe', name: 'Joe’s Mac', port: 47831, version: '1.10.0' })
  })
  it('rejects foreign / malformed datagrams', () => {
    expect(parseBeacon('not json')).toBeNull()
    expect(parseBeacon(JSON.stringify({ t: 'other' }))).toBeNull()
    expect(parseBeacon(JSON.stringify({ t: 'gitgud-peer', v: 1, peerId: 'ZZZ', name: 'x', port: 1 }))).toBeNull()
    expect(parseBeacon(JSON.stringify({ t: 'gitgud-peer', v: 1, peerId: 'deadbeef', name: 'x', port: 70000 }))).toBeNull()
  })
  it('clamps absurd names', () => {
    const b = parseBeacon(JSON.stringify({ t: 'gitgud-peer', v: 1, peerId: 'deadbeef', name: 'x'.repeat(500), port: 1 }))
    expect(b?.name.length).toBe(64)
  })
})

describe('peer-protocol: SSE framing', () => {
  it('parses events split across arbitrary chunk boundaries', () => {
    const frames = encodeSseEvent({ type: 'repo-changed', repoPath: '/a' }) + encodeSseEvent({ type: 'ping' }) + encodeSseEvent({ type: 'activity', record: { id: '1' } })
    const p = new SseParser()
    const out: unknown[] = []
    for (let i = 0; i < frames.length; i += 7) out.push(...p.feed(frames.slice(i, i + 7)))
    expect(out).toEqual([
      { type: 'repo-changed', repoPath: '/a' },
      { type: 'ping' },
      { type: 'activity', record: { id: '1' } },
    ])
  })
  it('tolerates CRLF, comments and malformed data', () => {
    const p = new SseParser()
    expect(p.feed(':ok\r\n\r\nevent: x\r\ndata: {bad\r\n\r\ndata: {"type":"ping"}\r\n\r\n')).toEqual([{ type: 'ping' }])
  })
})

describe('peer-protocol: pairing + tokens', () => {
  it('generates six-digit codes', () => {
    for (let i = 0; i < 50; i++) expect(generatePairingCode()).toMatch(/^\d{6}$/)
  })
  it('hashes tokens deterministically and compares safely', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'))
    expect(hashToken('abc')).not.toBe(hashToken('abd'))
    expect(safeEqual('123456', '123456')).toBe(true)
    expect(safeEqual('123456', '123457')).toBe(false)
    expect(safeEqual('12345', '123456')).toBe(false)
  })
  it('locks pairing after repeated failures and recovers', () => {
    const l = new PairRateLimiter(3, 1000, 5000)
    let now = 0
    l.recordFailure(now); l.recordFailure(now += 10)
    expect(l.isLocked(now)).toBe(false)
    l.recordFailure(now += 10)
    expect(l.isLocked(now)).toBe(true)
    expect(l.isLocked(now + 4999)).toBe(true)
    expect(l.isLocked(now + 5001)).toBe(false)
  })
  it('forgets failures outside the window', () => {
    const l = new PairRateLimiter(2, 1000, 5000)
    l.recordFailure(0)
    l.recordFailure(2000) // first one aged out
    expect(l.isLocked(2000)).toBe(false)
  })
})
