// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import simpleGit from 'simple-git'
import { GitService } from '../../src/main/git-service'
import { PeerServer, type PeerServerHost } from '../../src/main/peer-server'
import { PeerConnection, PeerRpcError, createRemoteRepoProxy } from '../../src/main/peer-client'
import { PeerStore } from '../../src/main/peer-store'
import { makePeerRepoPath, pairingProof, type PeerEvent } from '../../src/main/peer-protocol'
import { generateSelfSigned } from '../../src/main/peer-tls'

// Integration: a real PeerServer fronting a real GitService, talked to over
// loopback by the real PeerConnection + RemoteRepoProxy. Covers pairing,
// auth, the method whitelist, read-only mode, repo allow-listing, SSE events
// and proxy result shaping — the whole path main relies on.

describe('peer server ⇄ client over loopback', () => {
  let repo: string
  let storeDir: string
  let store: PeerStore
  let server: PeerServer
  let port: number
  let readOnly = false
  const watchers: Array<(ev: PeerEvent) => void> = []
  const self = { peerId: 'c11e47c11e47c11e', name: 'Client' }
  const tlsId = generateSelfSigned('Host')
  const endpoint = (token: string, certPem = tlsId.certPem) =>
    ({ peerId: 'h057h057h057h057', name: 'Host', host: '127.0.0.1', port, token, certPem })

  beforeAll(async () => {
    // realpath: macOS tmp lives under /var → /private/var and git reports the real path
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'peer-repo-')))
    storeDir = mkdtempSync(join(tmpdir(), 'peer-host-'))
    const g = simpleGit(repo)
    await g.init(['-b', 'main'] as any)
    await g.addConfig('user.name', 'T').then(() => g.addConfig('user.email', 't@t.t'))
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    await g.add('.').then(() => g.commit('first'))
    await g.raw(['branch', 'feature'])

    store = new PeerStore(storeDir)
    const svc = new GitService(repo)
    const host: PeerServerHost = {
      info: () => ({ peerId: 'h057h057h057h057', name: 'Host', version: '1.10.0', platform: 'test', protocol: 1, fingerprint: tlsId.fingerprint }),
      tls: () => tlsId,
      readOnly: () => readOnly,
      listRepos: () => [{ path: repo, name: 'repo', open: true }],
      resolveRepo: async (p) => (p === repo ? svc : null),
      watchRepo: (_p, cb) => { watchers.push(cb); return () => { const i = watchers.indexOf(cb); if (i >= 0) watchers.splice(i, 1) } },
      verifyToken: (t) => store.findByToken(t),
      registerPaired: (peerId, name, token) => { store.addPaired(peerId, name, token) },
    }
    server = new PeerServer(host)
    port = await server.start(47900)
  })

  afterAll(() => {
    server.stop()
    rmSync(repo, { recursive: true, force: true })
    rmSync(storeDir, { recursive: true, force: true })
  })

  it('serves TLS: /info (no auth) returns the cert we can pin, and reports its fingerprint', async () => {
    const { info, certPem } = await PeerConnection.probe('127.0.0.1', port)
    expect(info).toMatchObject({ peerId: 'h057h057h057h057', name: 'Host', protocol: 1, fingerprint: tlsId.fingerprint })
    expect(certPem.replace(/\s/g, '')).toBe(tlsId.certPem.replace(/\s/g, ''))
  })

  it('refuses a wrong pairing code and rotates the code on success', async () => {
    const wrong = server.code === '000000' ? '000001' : '000000'
    await expect(PeerConnection.pair('127.0.0.1', port, wrong, self, tlsId.certPem)).rejects.toThrow(/Wrong pairing code/)
    const before = server.code
    const { token, peer } = await PeerConnection.pair('127.0.0.1', port, before, self, tlsId.certPem)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(peer.name).toBe('Host')
    expect(server.code).not.toBe(before)
    expect(store.findByToken(token)?.name).toBe('Client')
  })

  it('pairing proof is bound to the host certificate (MITM with another cert cannot pair)', async () => {
    // A relay that terminates TLS with its own cert would make the client
    // compute the proof over THAT fingerprint — the host must reject it even
    // though the code is right.
    const mitm = generateSelfSigned('Evil')
    const badProof = pairingProof(server.code, mitm.fingerprint)
    expect(badProof).not.toBe(pairingProof(server.code, tlsId.fingerprint))
    const https = await import('https')
    const status = await new Promise<number>((resolve, reject) => {
      const req = https.request({ host: '127.0.0.1', port, path: '/gitgud/pair', method: 'POST', agent: false, rejectUnauthorized: false, headers: { 'Content-Type': 'application/json' } },
        (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)) })
      req.on('error', reject)
      req.end(JSON.stringify({ proof: badProof, peerId: 'bad0bad0bad0bad0', name: 'Evil' }))
    })
    expect(status).toBe(401)
  })

  it('refuses to talk to a host whose certificate does not match the pin', async () => {
    const other = generateSelfSigned('Other')
    const conn = new PeerConnection(endpoint('f'.repeat(64), other.certPem), self)
    await expect(conn.rpc(repo, 'getLog', [10])).rejects.toMatchObject({ code: 'tls' })
  })

  it('rejects RPC without a valid token', async () => {
    const conn = new PeerConnection(endpoint('f'.repeat(64)), self)
    await expect(conn.rpc(repo, 'getLog', [10])).rejects.toMatchObject({ code: 'unauthorized' })
    expect(conn.status).toBe('revoked')
  })

  describe('with a paired connection', () => {
    let conn: PeerConnection
    beforeAll(async () => {
      const { token } = await PeerConnection.pair('127.0.0.1', port, server.code, self, tlsId.certPem)
      conn = new PeerConnection(endpoint(token), self)
    })
    afterAll(() => conn.disconnect())

    it('lists repos and serves reads', async () => {
      expect(await conn.listRepos()).toEqual([{ path: repo, name: 'repo', open: true }])
      const log = await conn.rpc<Array<{ message: string }>>(repo, 'getLog', [50])
      expect(log.map((c) => c.message)).toEqual(['first'])
      const branches = await conn.rpc<{ local: Array<{ name: string }> }>(repo, 'getBranches', [])
      expect(branches.local.map((b) => b.name).sort()).toEqual(['feature', 'main'])
    })

    it('denies non-whitelisted methods without running git', async () => {
      await expect(conn.rpc(repo, 'reset', ['HEAD~1', 'hard'])).rejects.toMatchObject({ code: 'forbidden-method' })
      await expect(conn.rpc(repo, 'commitStreaming', [{ subject: 'x' }])).rejects.toMatchObject({ code: 'forbidden-method' })
      const log = await conn.rpc<unknown[]>(repo, 'getLog', [50])
      expect(log).toHaveLength(1)
    })

    it('gates sync ops behind read-only', async () => {
      readOnly = true
      try {
        await expect(conn.rpc(repo, 'checkout', ['feature'])).rejects.toMatchObject({ code: 'read-only' })
      } finally { readOnly = false }
      // Allowed again: a real checkout runs on the host.
      const r = await conn.rpc<{ success: boolean }>(repo, 'checkout', ['feature'])
      expect(r.success).toBe(true)
      expect((await simpleGit(repo).revparse(['--abbrev-ref', 'HEAD'])).trim()).toBe('feature')
      await conn.rpc(repo, 'checkout', ['main'])
    })

    it('refuses repos outside the allow-list', async () => {
      await expect(conn.rpc('/etc', 'getLog', [10])).rejects.toMatchObject({ code: 'forbidden-repo' })
      await expect(conn.rpc(tmpdir(), 'getStatus', [])).rejects.toMatchObject({ code: 'forbidden-repo' })
    })

    it('streams repo-changed events for subscribed repos', async () => {
      const events: PeerEvent[] = []
      conn.on('event', (e: PeerEvent) => events.push(e))
      conn.setSubscriptions([repo])
      conn.connect()
      await waitFor(() => conn.status === 'connected')
      await waitFor(() => watchers.length > 0)
      watchers[0]({ type: 'repo-changed', repoPath: repo })
      await waitFor(() => events.length > 0)
      expect(events[0]).toEqual({ type: 'repo-changed', repoPath: repo })
    })

    it('fans activity records out only to subscribers of that repo', async () => {
      const events: PeerEvent[] = []
      conn.on('event', (e: PeerEvent) => events.push(e))
      server.broadcastActivity('/some/other/repo', { id: 'x' })
      server.broadcastActivity(repo, { id: 'mine', repoPath: repo })
      await waitFor(() => events.some((e) => e.type === 'activity'))
      const acts = events.filter((e) => e.type === 'activity') as Array<{ record: { id: string } }>
      expect(acts.map((a) => a.record.id)).toEqual(['mine'])
    })

    it('proxy: rewrites worktree paths, shapes refusals per method', async () => {
      const peerPath = makePeerRepoPath('h057h057h057h057', repo)
      const activity: Array<{ args: string[]; failed: boolean; kind: string }> = []
      const proxy = createRemoteRepoProxy({ connection: conn, remotePath: repo, peerRepoPath: peerPath, onActivity: (r) => activity.push(r) }) as any

      expect(proxy.getRepoPath()).toBe(peerPath)
      const wts = await proxy.getWorktrees()
      expect(wts[0].path).toBe(peerPath)
      expect(wts[0].isMain).toBe(true)

      // Result-shaped handler → object, never a throw.
      const r = await proxy.rebaseTo('HEAD~1')
      expect(r).toMatchObject({ success: false })
      expect(String(r.error)).toMatch(/isn't available on a remote repository/)

      // try/catch-wrapped handler → throw.
      await expect(proxy.stage(['a.txt'])).rejects.toThrow(/isn't available/)

      // svc['git'] reach-ins don't resolve to a remote call.
      expect(proxy.git).toBeUndefined()

      expect(activity.some((a) => a.args[1] === 'getWorktrees' && a.kind === 'read' && !a.failed)).toBe(true)
      expect(activity.some((a) => a.args[1] === 'rebaseTo' && a.failed)).toBe(true)
    })

    it('revocation on the host turns into 401 → revoked status', async () => {
      store.revokePaired(self.peerId)
      let err: unknown
      try { await conn.rpc(repo, 'getStatus', []) } catch (e) { err = e }
      expect(err).toBeInstanceOf(PeerRpcError)
      expect((err as PeerRpcError).code).toBe('unauthorized')
      expect(conn.status).toBe('revoked')
    })
  })
})

async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition')
    await new Promise((r) => setTimeout(r, 20))
  }
}
