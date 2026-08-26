// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import simpleGit from 'simple-git'
import { GitService } from '../../src/main/git-service'
import { PeerServer, type PeerServerHost } from '../../src/main/peer-server'
import { PeerConnection } from '../../src/main/peer-client'
import { PeerStore } from '../../src/main/peer-store'
import { generateSelfSigned } from '../../src/main/peer-tls'
import { RelayLink, fingerprintHash } from '../../src/main/peer-relay'
import { RelayServer } from '../../src/relay/main'
import { pairingQrPayload, parsePairingQr, parseRelayUrl } from '@gitgud/peer-protocol'

// Relay end to end, in-process: relay service ⇄ host (PeerServer + RelayLink
// registered at the relay) ⇄ client (PeerConnection via relay://). The host
// listens on loopback only — the client never talks to it directly.
describe('rendezvous relay', () => {
  let repo: string, storeDir: string, relayDir: string
  let relay: RelayServer, relayPort: number, relayUrl: string
  let server: PeerServer, link: RelayLink, store: PeerStore
  const tlsId = generateSelfSigned('Host')
  const hostId = 'a0a0a0a0a0a0a0a0', hostToken = 'ff'.repeat(32)
  const self = { peerId: 'c1c1c1c1c1c1c1c1', name: 'Laptop' }
  const logs: string[] = []

  beforeAll(async () => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'relay-repo-')))
    storeDir = mkdtempSync(join(tmpdir(), 'relay-host-')); relayDir = mkdtempSync(join(tmpdir(), 'relay-data-'))
    const g = simpleGit(repo); await g.init(['-b', 'main'] as any); await g.addConfig('user.name', 'T'); await g.addConfig('user.email', 't@t.t')
    writeFileSync(join(repo, 'a.txt'), 'a\n'); await g.add('.'); await g.commit('first')
    relay = new RelayServer({ port: 0, bind: '127.0.0.1', dataDir: relayDir, log: (m, f) => logs.push(m + ' ' + JSON.stringify(f ?? {})) })
    relayPort = await relay.start()
    relayUrl = `relay://127.0.0.1:${relayPort}#${relay.fingerprint.replace(/:/g, '')}`
    store = new PeerStore(storeDir); const svc = new GitService(repo)
    const host: PeerServerHost = {
      info: () => ({ peerId: hostId, name: 'Host', version: '1.13.0', platform: 'linux-headless', protocol: 1, fingerprint: tlsId.fingerprint, readOnly: false }),
      tls: () => tlsId, readOnly: () => false, listRepos: () => [{ path: repo, name: 'repo', open: true }],
      resolveRepo: async (p) => (p === repo ? svc : null), watchRepo: () => () => {},
      verifyToken: (t) => store.findByToken(t), registerPaired: (id, n, t, o) => { store.addPaired(id, n, t, o) },
    }
    server = new PeerServer(host); await server.start(47980, '127.0.0.1', 5)
    link = new RelayLink({ relayUrl, peerId: hostId, token: hostToken, name: 'Host', fingerprint: () => tlsId.fingerprint, onSocket: (s) => { server.injectConnection(s) }, log: (m) => logs.push(m) })
    link.start()
    for (let i = 0; i < 100 && link.status !== 'registered'; i++) await new Promise((r) => setTimeout(r, 30))
  })
  afterAll(() => { link.stop(); server.stop(); relay.stop(); for (const d of [repo, storeDir, relayDir]) rmSync(d, { recursive: true, force: true }) })

  it('host registers at the relay (token bound on first registration)', () => {
    expect(link.status).toBe('registered')
    expect(relay.listHosts().map((h) => h.peerId)).toEqual([hostId])
    expect(parseRelayUrl(`${relayUrl.split('#')[0]}/${hostId}#${relay.fingerprint}`)).toMatchObject({ host: '127.0.0.1', port: relayPort, peerId: hostId })
  })

  it('client probes + pairs THROUGH the relay from a QR payload; pinned TLS runs end to end', async () => {
    const payload = pairingQrPayload({ host: '10.255.255.1', port: 1, fingerprint: tlsId.fingerprint, code: server.code, relay: `${relayUrl.split('#')[0]}/${hostId}#${relay.fingerprint.replace(/:/g, '')}` })
    const qr = parsePairingQr(payload)!
    const route = { url: qr.relay!, peerId: hostId, fingerprint: qr.fingerprint }
    const { info, certPem } = await PeerConnection.probe('gitgud-peer', 0, route)
    expect(info.name).toBe('Host'); expect(info.fingerprint).toBe(tlsId.fingerprint)
    const r = await PeerConnection.pair('gitgud-peer', 0, qr.code, self, certPem, 'desktop', route)
    expect(r.token).toMatch(/^[0-9a-f]{64}$/)
    const conn = new PeerConnection({ peerId: hostId, name: 'Host', host: qr.relay!, port: 0, token: r.token, certPem, relay: qr.relay! }, self)
    const log = await conn.rpc<Array<{ message: string }>>(repo, 'getLog', [10]); expect(log[0].message).toBe('first')
    await conn.rpc(repo, 'createBranch', ['via-relay'])
    const br = await conn.rpc<{ local: Array<{ name: string }> }>(repo, 'getBranches', []); expect(br.local.map((b) => b.name)).toContain('via-relay')
    // SSE through the relay
    const events: string[] = []
    conn.on('event', (e: { type: string }) => events.push(e.type))
    conn.setSubscriptions([repo]); conn.connect()
    for (let i = 0; i < 100 && conn.status !== 'connected'; i++) await new Promise((r) => setTimeout(r, 30))
    expect(conn.status).toBe('connected')
    server.broadcastActivity(repo, { id: 'x' })
    for (let i = 0; i < 100 && !events.includes('activity'); i++) await new Promise((r) => setTimeout(r, 20))
    expect(events).toContain('activity')
    conn.disconnect()
    expect(relay.stats.splices).toBeGreaterThanOrEqual(4)
    expect(relay.stats.bytes).toBeGreaterThan(1000)
  })

  it('relay refuses unknown peers and wrong fingerprint hashes identically (no enumeration)', async () => {
    const wrongFp = generateSelfSigned('X').fingerprint
    await expect(PeerConnection.probe('gitgud-peer', 0, { url: relayUrl, peerId: hostId, fingerprint: wrongFp })).rejects.toThrow(/no such host/)
    await expect(PeerConnection.probe('gitgud-peer', 0, { url: relayUrl, peerId: 'b2b2b2b2b2b2b2b2', fingerprint: tlsId.fingerprint })).rejects.toThrow(/no such host/)
    expect(fingerprintHash('AA:BB')).toBe(fingerprintHash('aabb'))
  })

  it('a host with the wrong token cannot take over a bound peer id', async () => {
    const rogue = new RelayLink({ relayUrl, peerId: hostId, token: 'ee'.repeat(32), name: 'Rogue', fingerprint: () => tlsId.fingerprint, onSocket: () => {} })
    rogue.start()
    for (let i = 0; i < 100 && rogue.status === 'connecting'; i++) await new Promise((r) => setTimeout(r, 30))
    expect(rogue.status).toBe('offline'); expect(rogue.lastError).toMatch(/refused/)
    rogue.stop()
    expect(relay.listHosts().map((h) => h.peerId)).toEqual([hostId])
  })

  it('a client pinned to a different certificate fails the inner TLS handshake even through the relay', async () => {
    const other = generateSelfSigned('Other')
    const conn = new PeerConnection({ peerId: hostId, name: 'Host', host: relayUrl, port: 0, token: 'f'.repeat(64), certPem: other.certPem, relay: relayUrl }, self)
    await expect(conn.rpc(repo, 'getLog', [1])).rejects.toMatchObject({ code: expect.stringMatching(/tls|network/) })
  })
})
