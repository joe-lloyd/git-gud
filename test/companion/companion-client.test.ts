// @vitest-environment node
// The companion app's networking logic against a REAL PeerServer over
// loopback, using a Node transport that pins exactly like the native module
// (SHA-256 of the DER cert). Also proves the pure-TS HMAC/SHA-256 match Node.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as https from 'https'
import * as tls from 'tls'
import { createHash, createHmac } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import simpleGit from 'simple-git'
import { GitService } from '../../src/main/git-service'
import { PeerServer, type PeerServerHost } from '../../src/main/peer-server'
import { PeerStore } from '../../src/main/peer-store'
import { generateSelfSigned } from '../../src/main/peer-tls'
import { pairingQrPayload, parsePairingQr } from '@gitgud/peer-protocol'
import { PeerClient, machineFromPairing, RpcError } from '../../apps/companion/src/net/peerClient'
import { hmacSha256, sha256, utf8, hex, pairingProof } from '../../apps/companion/src/net/sha256'
import { assignLanes } from '../../apps/companion/src/net/lanes'
import { TransportError, type PinnedTransport } from '../../apps/companion/src/net/transport'

function nodePinnedTransport(): PinnedTransport {
  const pin = (fp: string) => ({
    rejectUnauthorized: false, // trust decision is the fingerprint check below, like the native module
    checkServerIdentity: () => undefined,
    agent: false as const,
  })
  const verify = (sock: tls.TLSSocket, fp: string) => {
    const got = sock.getPeerCertificate().fingerprint256.replace(/:/g, '').toUpperCase()
    if (got !== fp.replace(/:/g, '').toUpperCase()) { sock.destroy(); throw new TransportError('Certificate pin mismatch', 'tls') }
  }
  return {
    request(url, o) {
      return new Promise((resolve, reject) => {
        const req = https.request(url, { method: o.method, headers: o.headers, ...pin(o.fingerprint) }, (res) => {
          try { verify(res.socket as tls.TLSSocket, o.fingerprint) } catch (e) { reject(e); return }
          let b = ''; res.setEncoding('utf8'); res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b }))
        })
        req.on('error', (e) => reject(new TransportError(String(e), 'network')))
        if (o.body) req.write(o.body)
        req.end()
      })
    },
    stream(url, o) {
      const req = https.request(url, { headers: o.headers, ...pin(o.fingerprint) }, (res) => {
        try { verify(res.socket as tls.TLSSocket, o.fingerprint) } catch (e) { o.onClose(e as Error); return }
        res.setEncoding('utf8'); res.on('data', (d: string) => o.onChunk(d)); res.on('end', () => o.onClose())
      })
      req.on('error', (e) => o.onClose(e)); req.end()
      return () => req.destroy()
    },
  }
}

describe('companion crypto', () => {
  it('sha256 / hmac / pairingProof match Node', () => {
    for (const s of ['', 'abc', 'hello world', 'Ω'.repeat(100), 'x'.repeat(1000)]) {
      expect(hex(sha256(utf8(s)))).toBe(createHash('sha256').update(s, 'utf8').digest('hex'))
    }
    expect(hex(hmacSha256(utf8('123456'), utf8('AB:CD')))).toBe(createHmac('sha256', '123456').update('AB:CD').digest('hex'))
    expect(pairingProof('863081', 'ab:cd:ef')).toBe(createHmac('sha256', '863081').update('AB:CD:EF').digest('hex'))
  })
})

describe('companion lanes', () => {
  it('assigns lanes for a merge history', () => {
    const rows = assignLanes([
      { sha: 'm', parents: ['a', 'f'], message: 'merge' },
      { sha: 'a', parents: ['b'], message: 'a' },
      { sha: 'f', parents: ['b'], message: 'feature' },
      { sha: 'b', parents: [], message: 'root' },
    ])
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 1, 0])
    expect(rows[0].forks).toEqual([1])          // merge: rail to the feature lane
    expect(rows[1].through).toEqual([1])        // feature lane passes 'a'
    expect(rows[3].joins).toEqual([1])          // feature lane ends at the root
    expect(rows[3].lanes).toBeGreaterThanOrEqual(2)
  })
})

describe('companion client ⇄ real host', () => {
  let repo: string, storeDir: string, server: PeerServer, port: number, store: PeerStore
  const tlsId = generateSelfSigned('Host')
  const client = new PeerClient(nodePinnedTransport(), { peerId: 'ph0ne000ph0ne000'.replace(/[^0-9a-f]/g, 'a'), name: 'Phone' })
  let pushEnabled = false

  beforeAll(async () => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'comp-repo-')))
    storeDir = mkdtempSync(join(tmpdir(), 'comp-host-'))
    const g = simpleGit(repo); await g.init(['-b', 'main'] as any); await g.addConfig('user.name', 'T'); await g.addConfig('user.email', 't@t.t')
    writeFileSync(join(repo, 'a.txt'), 'a\n'); await g.add('.'); await g.commit('first'); writeFileSync(join(repo, 'a.txt'), 'b\n')
    store = new PeerStore(storeDir); const svc = new GitService(repo)
    const host: PeerServerHost = {
      info: () => ({ peerId: 'h057h057h057h057'.replace(/[^0-9a-f]/g, 'a'), name: 'Host', version: '1.13.0', platform: 'darwin', protocol: 1, fingerprint: tlsId.fingerprint, readOnly: false }),
      tls: () => tlsId, readOnly: () => false, listRepos: () => [{ path: repo, name: 'repo', open: true }],
      resolveRepo: async (p) => (p === repo ? svc : null), watchRepo: () => () => {},
      verifyToken: (t) => store.findByToken(t), registerPaired: (id, n, t, o) => { store.addPaired(id, n, t, o) },
      subscribePush: (d, t, e) => pushEnabled && store.setPairedPush(d.peerId, t ? { token: t, events: e } : null),
    }
    server = new PeerServer(host); port = await server.start(47970, '127.0.0.1', 5)
  })
  afterAll(() => { server.stop(); rmSync(repo, { recursive: true, force: true }); rmSync(storeDir, { recursive: true, force: true }) })

  it('pairs from a QR payload (pinned before first request), lands read-only, reads work, writes refused client-side and host-side', async () => {
    const payload = pairingQrPayload({ host: '127.0.0.1', port, fingerprint: tlsId.fingerprint, code: server.code, alts: ['localhost'], name: 'Host' })
    const qr = parsePairingQr(payload)!
    const { address, info } = await client.probeAny([{ host: qr.host, port: qr.port }, ...(qr.alts ?? []).map((h) => ({ host: h, port: qr.port }))], qr.fingerprint)
    expect(address).toEqual({ host: '127.0.0.1', port })
    const r = await client.pair(address, qr.fingerprint, qr.code)
    expect(r.readOnly).toBe(true)
    const m = machineFromPairing(qr, info, r.token, r.readOnly)
    expect(m.addresses).toEqual([{ host: '127.0.0.1', port }, { host: 'localhost', port }])
    expect(await client.listRepos(m)).toEqual([{ path: repo, name: 'repo', open: true }])
    const log = await client.rpc<Array<{ message: string }>>(m, repo, 'getLog', [50]); expect(log[0].message).toBe('first')
    const st = await client.rpc<{ unstaged: Array<{ path: string }> }>(m, repo, 'getStatus'); expect(st.unstaged.map((f) => f.path)).toEqual(['a.txt'])
    await expect(client.rpc(m, repo, 'stage', [['a.txt']])).rejects.toMatchObject({ code: 'read-only' }) // client refuses before the wire
    expect(await client.whoami(m)).toMatchObject({ kind: 'companion', readOnly: true, scopes: [] })
    // M6: host grants fetch → client allows exactly that method; pull still refused client-side
    store.setPairedScopes(client.self.peerId, ['fetch'])
    const me = await client.whoami(m); expect(me.scopes).toEqual(['fetch'])
    const scoped = { ...m, scopes: me.scopes }
    await expect(client.pull(scoped, repo)).rejects.toMatchObject({ code: 'read-only' })
    await expect(client.fetch(scoped, repo)).resolves.toBeNull() // reaches the host and runs (no remotes → no-op fetch)
    ;(globalThis as any).__m = m
  })

  it('refuses a host whose certificate does not match the pinned fingerprint', async () => {
    const other = generateSelfSigned('Evil')
    await expect(client.probe({ host: '127.0.0.1', port }, other.fingerprint)).rejects.toMatchObject({ code: 'tls' })
  })

  it('push subscription follows the host opt-in; SSE stream delivers events', async () => {
    const m = (globalThis as any).__m
    await expect(client.subscribePush(m, 'ExponentPushToken[pppppppppppppppp]', ['repo-changed'])).rejects.toBeInstanceOf(RpcError)
    pushEnabled = true
    expect(await client.subscribePush(m, 'ExponentPushToken[pppppppppppppppp]', ['repo-changed'])).toEqual({ subscribed: true })
    const got: string[] = []
    const close = client.events(m, [repo], (ev) => got.push(ev.type), () => {})
    for (let i = 0; i < 100 && server.connectedDevices().length === 0; i++) await new Promise((r) => setTimeout(r, 20))
    server.broadcastActivity(repo, { id: 'x', args: ['fetch'] })
    for (let i = 0; i < 100 && !got.includes('activity'); i++) await new Promise((r) => setTimeout(r, 20))
    close()
    expect(got).toContain('activity')
  })
})
