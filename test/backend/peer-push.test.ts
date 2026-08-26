// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { PushNotifier, isExpoPushToken } from '../../src/main/peer-push'

describe('push notifier', () => {
  it('validates Expo push tokens', () => {
    expect(isExpoPushToken('ExponentPushToken[abcDEF123456-_xyz]')).toBe(true)
    expect(isExpoPushToken('ExpoPushToken[abcDEF123456xyz]')).toBe(true)
    expect(isExpoPushToken('garbage')).toBe(false)
  })

  it('sends immediately, then debounces per device/repo/kind for 30 s (trailing), honours enabled + event filters', () => {
    vi.useFakeTimers()
    const sent: unknown[][] = []
    let enabled = true
    const n = new PushNotifier({
      enabled: () => enabled,
      subscribers: () => [
        { peerId: 'a', pushToken: 'ExponentPushToken[aaaaaaaaaaaaaaaa]', events: ['repo-changed'] },
        { peerId: 'b', pushToken: 'ExponentPushToken[bbbbbbbbbbbbbbbb]', events: ['activity'] },
      ],
      machineName: () => 'nas',
      send: async (m) => { sent.push(m) },
    })
    n.notify('/srv/git/blog', 'repo-changed')
    expect(sent).toHaveLength(1)
    expect(sent[0][0]).toMatchObject({ to: 'ExponentPushToken[aaaaaaaaaaaaaaaa]', title: 'blog changed', body: 'on nas', data: { machine: 'nas', repo: 'blog', kind: 'repo-changed' } })
    n.notify('/srv/git/blog', 'repo-changed'); n.notify('/srv/git/blog', 'repo-changed')
    expect(sent).toHaveLength(1) // coalesced
    vi.advanceTimersByTime(30_000)
    expect(sent).toHaveLength(2) // one trailing send
    n.notify('/srv/git/blog', 'activity', 'push')
    expect(sent).toHaveLength(3); expect(sent[2][0]).toMatchObject({ to: 'ExponentPushToken[bbbbbbbbbbbbbbbb]', title: 'blog: push' })
    enabled = false
    n.notify('/srv/git/other', 'repo-changed')
    expect(sent).toHaveLength(3)
    n.stop(); vi.useRealTimers()
  })
})
