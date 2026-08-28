// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { companionSafeArgs } from '../../src/main/peer-server'

describe('companionSafeArgs — scoped writes from a read-only device', () => {
  it('forces a fast-forward-only pull no matter what the client asked for', () => {
    expect(companionSafeArgs('pull', [{ rebase: true, autoStash: true }])).toEqual([{ ffOnly: true, autoStash: false }])
    expect(companionSafeArgs('pull', [])).toEqual([{ ffOnly: true, autoStash: false }])
  })
  it('never lets a phone force-push', () => {
    expect(companionSafeArgs('push', [true])).toEqual([false])
    expect(companionSafeArgs('push', [])).toEqual([false])
  })
  it('fetch takes no arguments; everything else passes through', () => {
    expect(companionSafeArgs('fetch', ['--force'])).toEqual([])
    expect(companionSafeArgs('getLog', [200])).toEqual([200])
  })
})
