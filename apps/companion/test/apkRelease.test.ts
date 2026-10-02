import { describe, it, expect } from 'vitest'
import { compareVersions, newerApk, parseReleases } from '../src/apkRelease'

const rel = (tag: string, opts: { prerelease?: boolean; draft?: boolean; apk?: boolean } = {}) => ({
  tag_name: tag,
  draft: opts.draft ?? false,
  prerelease: opts.prerelease ?? tag.includes('-'),
  assets: [
    { name: `Git-Gud-${tag.slice(1)}.dmg`, browser_download_url: `https://example.test/${tag}/dmg`, size: 1 },
    ...(opts.apk === false ? [] : [{ name: `Git-Gud-Companion-${tag.slice(1)}.apk`, browser_download_url: `https://example.test/${tag}/apk`, size: 42 }]),
  ],
})

describe('compareVersions', () => {
  it('orders releases and prereleases like semver', () => {
    const sorted = ['1.21.0', '1.20.1', '1.21.0-dev.1', '1.21.0-dev.0', '1.3.0', '1.21.0-dev.10']
      .sort(compareVersions)
    expect(sorted).toEqual(['1.3.0', '1.20.1', '1.21.0-dev.0', '1.21.0-dev.1', '1.21.0-dev.10', '1.21.0'])
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0)
  })
})

describe('newerApk', () => {
  const releases = parseReleases([rel('v1.22.0-dev.0'), rel('v1.21.1', { apk: false }), rel('v1.21.0'), rel('v1.20.1'), rel('v1.23.0', { draft: true })])

  it('offers the newest stable APK to a stable build, skipping drafts, prereleases and releases without an APK', () => {
    expect(newerApk(releases, '1.20.1')).toEqual({ version: '1.21.0', tag: 'v1.21.0', url: 'https://example.test/v1.21.0/apk', name: 'Git-Gud-Companion-1.21.0.apk', size: 42 })
  })
  it('returns null when the running build is current', () => {
    expect(newerApk(releases, '1.21.0')).toBeNull()
  })
  it('offers newer dev releases to a dev build', () => {
    expect(newerApk(releases, '1.21.0-dev.3')?.version).toBe('1.22.0-dev.0')
  })
  it('lets a dev build move to the stable release of the same version', () => {
    expect(newerApk(parseReleases([rel('v1.22.0'), rel('v1.22.0-dev.0')]), '1.22.0-dev.0')?.version).toBe('1.22.0')
  })
})

describe('parseReleases', () => {
  it('drops malformed entries and rejects a non-list body', () => {
    expect(parseReleases([{ tag_name: 1 }, null, rel('v1.0.0')]).map((r) => r.tag)).toEqual(['v1.0.0'])
    expect(() => parseReleases({ message: 'API rate limit exceeded' })).toThrow('Unexpected GitHub response')
  })
})
