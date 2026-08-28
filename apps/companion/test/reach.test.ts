import { describe, it, expect } from 'vitest'
import { addressesFor, relayAddress, withRelay, machineFromPairing } from '../src/net/peerClient'

const peer = { peerId: 'a0a0a0a0a0a0a0a0', name: 'Host', version: '1.15.0', platform: 'darwin', protocol: 1, fingerprint: 'AB:CD', relay: 'relay://r.example.com:47833/a0a0a0a0a0a0a0a0#' + 'FE'.repeat(32) }

describe('reachability addresses', () => {
  it('turns a relay route into an SNI-routed address (TCP to the relay, name = <peerId>.gitgud-relay)', () => {
    expect(relayAddress(peer.relay, peer.peerId)).toEqual({ host: 'a0a0a0a0a0a0a0a0.gitgud-relay', port: 47833, relay: { host: 'r.example.com', port: 47833 } })
    expect(relayAddress(undefined, peer.peerId)).toBeNull()
    expect(relayAddress('nonsense', peer.peerId)).toMatchObject({ relay: { host: 'nonsense' } }) // bare host = relay on the default port
  })
  it('orders direct addresses first and the relay last', () => {
    const a = addressesFor({ host: '192.168.1.5', port: 47831, alts: ['mac.tail1.ts.net'] }, peer)
    expect(a.map((x) => x.host)).toEqual(['192.168.1.5', 'mac.tail1.ts.net', 'a0a0a0a0a0a0a0a0.gitgud-relay'])
    expect(a[2].relay).toEqual({ host: 'r.example.com', port: 47833 })
  })
  it('a host that later gets a relay is learned from /info; unchanged routes are a no-op', () => {
    const m = machineFromPairing({ host: '10.0.0.2', port: 47831, fingerprint: 'AB:CD' }, { ...peer, relay: undefined }, 'tok', true)
    expect(m.addresses.some((x) => x.relay)).toBe(false)
    const merged = withRelay(m.addresses, peer.relay, peer.peerId)!
    expect(merged.map((x) => x.host)).toEqual(['10.0.0.2', 'a0a0a0a0a0a0a0a0.gitgud-relay'])
    expect(withRelay(merged, peer.relay, peer.peerId)).toBeNull()
    expect(withRelay(merged, 'relay://other.example.com:1', peer.peerId)!.at(-1)!.relay).toEqual({ host: 'other.example.com', port: 1 })
  })
})
