// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PeerService } from '../../src/main/peer-service'

// Regression: v1.13.0 crashed Settings ("Cannot read properties of undefined
// (reading 'url')") because getState() omitted server.push / server.relay
// while the renderer read them unconditionally.
const dir = mkdtempSync(join(tmpdir(), 'gg-peer-state-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('PeerService.getState', () => {
  it('always includes every server field the renderer reads', () => {
    const svc = new PeerService({
      userDataDir: dir,
      crypter: { encrypt: (p) => Buffer.from(p), decrypt: (b) => b.toString() },
      appVersion: '0.0.0-test',
      listLocalRepos: () => [],
      resolveLocalRepo: async () => null,
      watchLocalRepo: () => () => {},
      onRemoteRepoChanged: () => {},
      onActivity: () => {},
      publish: () => {},
    })
    const { server } = svc.getState()
    expect(server.running).toBe(false)
    expect(typeof server.push).toBe('boolean')
    expect(server.relay).toEqual({ url: expect.any(String), status: 'offline', error: '' })
    for (const key of ['enabled', 'port', 'readOnly', 'pairingCode', 'fingerprint', 'error', 'paired'] as const) {
      expect(server).toHaveProperty(key)
    }
  })
})

import { fitPairingPayload, QR_MAX_BYTES } from '../../src/main/peer-service'
import { parsePairingQr } from '@gitgud/peer-protocol'
import { encodeQr } from '../../src/main/qr'

describe('fitPairingPayload', () => {
  const base = { host: '192.168.2.6', port: 47831, fingerprint: 'AB'.repeat(32), code: '123456' }
  it('keeps everything when it fits', () => {
    const out = fitPairingPayload({ ...base, alts: ['joes-mac.local'], name: 'Joe' })
    expect(parsePairingQr(out)).toMatchObject({ host: base.host, alts: ['joes-mac.local'], name: 'Joe' })
  })
  it('drops name, then alts, until the QR encoder can take it — never host/fp/code/relay', () => {
    const alts = Array.from({ length: 6 }, (_, i) => `very-long-interface-name-${i}.tail1234.ts.net`)
    const relay = 'relay://relay.example.com:47833/' + 'ab'.repeat(16) + '#' + 'CD'.repeat(32)
    // Fits the real encoder (v20) with everything present …
    const full = fitPairingPayload({ ...base, alts, name: 'Joe-Lloyd-V5H23GXJPK', relay })
    expect(Buffer.byteLength(full)).toBeLessThanOrEqual(QR_MAX_BYTES)
    expect(parsePairingQr(full)!.name).toBe('Joe-Lloyd-V5H23GXJPK')
    expect(() => encodeQr(full)).not.toThrow()
    // … and degrades in order under a tight budget.
    const out = fitPairingPayload({ ...base, alts, name: 'Joe-Lloyd-V5H23GXJPK', relay }, 300)
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(300)
    const p = parsePairingQr(out)!
    expect(p.host).toBe(base.host); expect(p.code).toBe('123456'); expect(p.relay).toBe(relay)
    expect(p.name).toBeUndefined()
    expect((p.alts ?? []).length).toBeLessThan(alts.length)
  })
})
