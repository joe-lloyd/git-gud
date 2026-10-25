import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Machine } from '../src/net/peerClient'

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }))
vi.mock('expo-secure-store', () => ({
  getItemAsync: () => { throw new Error('Native storage on web') },
  setItemAsync: () => { throw new Error('Native storage on web') },
}))
vi.mock('../src/net/peerClient', () => ({ newSelf: (name: string) => ({ peerId: 'preview', name }) }))

beforeEach(() => {
  vi.resetModules()
  const unavailable = () => { throw new Error('Browser storage must not be accessed') }
  vi.stubGlobal('localStorage', { getItem: unavailable, setItem: unavailable })
  vi.stubGlobal('sessionStorage', { getItem: unavailable, setItem: unavailable })
})
afterEach(() => vi.unstubAllGlobals())

test('web pairing works for this page and disappears on a new page load', async () => {
  const store = await import('../src/state/store')
  const machine: Machine = {
    peerId: 'host', name: 'Host', addresses: [], fingerprint: 'test',
    token: 'test-only-bearer', readOnly: true, platform: 'test', version: '1', pairedAt: 0,
  }
  await store.saveMachines([machine])
  expect(await store.loadMachines()).toEqual([machine])
  expect(await store.loadSelf('Browser')).toEqual({ peerId: 'preview', name: 'Browser' })
  vi.resetModules()
  const nextPage = await import('../src/state/store')
  expect(await nextPage.loadMachines()).toEqual([])
})
