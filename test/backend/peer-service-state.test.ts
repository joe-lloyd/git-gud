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
