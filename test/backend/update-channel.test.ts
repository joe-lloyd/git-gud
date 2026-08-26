import { describe, it, expect } from 'vitest'
import { compareVersions, isNewerVersion, pickRelease, defaultChannelFor, isUpdateChannel } from '../../src/main/update-channel'

describe('compareVersions / isNewerVersion', () => {
  it('orders numeric cores', () => {
    expect(isNewerVersion('1.10.0', '1.11.0')).toBe(true)
    expect(isNewerVersion('1.11.0', '1.10.9')).toBe(false)
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0)
  })
  it('ranks a prerelease below its release and stable above older dev builds', () => {
    expect(isNewerVersion('1.11.0-dev.1', '1.11.0')).toBe(true)   // dev → stable upgrade
    expect(isNewerVersion('1.11.0', '1.11.0-dev.5')).toBe(false)  // never downgrade to dev
    expect(isNewerVersion('1.10.0', '1.11.0-dev.0')).toBe(true)   // stable → dev channel
    expect(isNewerVersion('1.11.0-dev.1', '1.10.0')).toBe(false)  // dev → stable: wait
  })
  it('compares prerelease identifiers numerically', () => {
    expect(isNewerVersion('1.11.0-dev.9', '1.11.0-dev.10')).toBe(true)
    expect(isNewerVersion('1.11.0-dev.10', '1.11.0-dev.9')).toBe(false)
    expect(compareVersions('1.11.0-dev.1', '1.11.0-dev.1')).toBe(0)
  })
})

describe('pickRelease', () => {
  const releases = [
    { tag_name: 'v1.11.0-dev.1', prerelease: true },
    { tag_name: 'v1.10.0', prerelease: false },
    { tag_name: 'v1.11.0-dev.0', prerelease: true },
    { tag_name: 'v1.9.0', prerelease: false },
    { tag_name: 'v9.9.9', prerelease: false, draft: true },
  ]
  it('stable ignores pre-releases and drafts', () => {
    expect(pickRelease(releases, 'stable')?.tag_name).toBe('v1.10.0')
  })
  it('dev takes the highest version including pre-releases', () => {
    expect(pickRelease(releases, 'dev')?.tag_name).toBe('v1.11.0-dev.1')
    expect(pickRelease([...releases, { tag_name: 'v1.11.0', prerelease: false }], 'dev')?.tag_name).toBe('v1.11.0')
  })
  it('returns null when nothing qualifies', () => {
    expect(pickRelease([], 'dev')).toBeNull()
  })
})

describe('channel defaults', () => {
  it('prerelease builds default to dev, others to stable', () => {
    expect(defaultChannelFor('1.11.0-dev.1')).toBe('dev')
    expect(defaultChannelFor('1.11.0')).toBe('stable')
    expect(isUpdateChannel('dev')).toBe(true)
    expect(isUpdateChannel('nightly')).toBe(false)
  })
})
