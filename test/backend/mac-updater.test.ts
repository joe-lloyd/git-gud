import { describe, it, expect, vi } from 'vitest'

// mac-updater imports electron's `app` at module scope; the pure helpers under
// test never touch it, so a stub is enough to load the module in node.
vi.mock('electron', () => ({ app: {} }))

import { parseFeed, isNewerVersion, pickAsset } from '../../src/main/mac-updater'

const FEED = `version: 1.1.1
files:
  - url: Git-Gud-1.1.1-arm64-mac.zip
    sha512: YJrLsPqozKWKRuawy3UGl+cX6syWJAegouH2gs2VUcoCQNDFDelqnzaYR3XaKHNJCKwSsazFI7lIlMj2127SyQ==
    size: 94555458
  - url: Git-Gud-1.1.1-mac.zip
    sha512: yl+S2h/nDrb6P+GuPrr7pNCCmtL4cJE3GiJwhhXi6FDOIGVA1AO2LDJjs8UZpnll2Kq6fXrEQttAnruZ+DInNw==
    size: 99793134
  - url: Git-Gud-1.1.1.dmg
    sha512: u9n/49gpkU2dl/M12RfR586WTc2JRvDWLUBcK4lBYeYJv/Fhenm6VOgwhsN/AMCr9k7QzkL/uwHxUPOoeJtdkQ==
    size: 104185498
path: Git-Gud-1.1.1-arm64-mac.zip
sha512: YJrLsPqozKWKRuawy3UGl+cX6syWJAegouH2gs2VUcoCQNDFDelqnzaYR3XaKHNJCKwSsazFI7lIlMj2127SyQ==
releaseDate: '2026-08-03T19:54:01.358Z'
`

describe('parseFeed', () => {
  it('extracts version and the files list from latest-mac.yml', () => {
    const feed = parseFeed(FEED)
    expect(feed.version).toBe('1.1.1')
    expect(feed.files).toHaveLength(3)
    expect(feed.files[0]).toEqual({
      url: 'Git-Gud-1.1.1-arm64-mac.zip',
      sha512: 'YJrLsPqozKWKRuawy3UGl+cX6syWJAegouH2gs2VUcoCQNDFDelqnzaYR3XaKHNJCKwSsazFI7lIlMj2127SyQ==',
      size: 94555458,
    })
  })

  it('returns empty results for garbage input', () => {
    const feed = parseFeed('not: yaml: at: all')
    expect(feed.version).toBe('')
    expect(feed.files).toHaveLength(0)
  })
})

describe('isNewerVersion', () => {
  it('detects newer patch/minor/major versions', () => {
    expect(isNewerVersion('1.1.1', '1.1.2')).toBe(true)
    expect(isNewerVersion('1.1.1', '1.2.0')).toBe(true)
    expect(isNewerVersion('1.9.9', '2.0.0')).toBe(true)
  })

  it('rejects equal and older versions', () => {
    expect(isNewerVersion('1.1.1', '1.1.1')).toBe(false)
    expect(isNewerVersion('1.1.2', '1.1.1')).toBe(false)
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false)
  })

  it('handles v-prefixes and unequal lengths', () => {
    expect(isNewerVersion('v1.1.1', '1.1.2')).toBe(true)
    expect(isNewerVersion('1.1', '1.1.1')).toBe(true)
    expect(isNewerVersion('1.1.0', '1.1')).toBe(false)
  })
})

describe('pickAsset', () => {
  const files = parseFeed(FEED).files

  it('picks the arm64 zip on arm64', () => {
    expect(pickAsset(files, 'arm64')?.url).toBe('Git-Gud-1.1.1-arm64-mac.zip')
  })

  it('picks the plain mac zip on x64 (never the dmg)', () => {
    expect(pickAsset(files, 'x64')?.url).toBe('Git-Gud-1.1.1-mac.zip')
  })

  it('returns null when no zip matches', () => {
    expect(pickAsset([{ url: 'Git-Gud-1.1.1.dmg', sha512: 'x', size: 1 }], 'arm64')).toBeNull()
  })
})
