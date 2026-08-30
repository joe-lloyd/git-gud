// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import simpleGit from 'simple-git'
import { GitService } from '../../src/main/git-service'
import { PeerServer, type PeerServerHost } from '../../src/main/peer-server'
import { PeerConnection, createRemoteRepoProxy } from '../../src/main/peer-client'
import { PeerStore } from '../../src/main/peer-store'
import { canonicalPath, createRepoHost, createPeerServerHost } from '../../src/main/peer-host-core'
import { makePeerRepoPath, type PairReciprocal } from '@gitgud/peer-protocol'

const PORT_A = 47971, PORT_B = 47972

async function mkRepo(prefix: string): Promise<string> {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  const g = simpleGit(repo)
  await g.init(['-b', 'main'] as never); await g.addConfig('user.name', 'T'); await g.addConfig('user.email', 't@t.t')
  writeFileSync(join(repo, 'a.txt'), 'a\n'); await g.add('.'); await g.commit('first')
  return repo
}

describe('reciprocal pairing + worktrees over the wire', () => {
  let repoA: string, repoB: string, wtB: string
  let storeA: PeerStore, storeB: PeerStore
  let serverA: PeerServer, serverB: PeerServer
  let dirs: string[] = []
  // What B receives through the pairing request (normally peer-service wires this to upsertKnown+connect).
  let bLearned: { peerId: string; name?: string; token: string; certPem: string; host: string; port: number } | null = null
  let tokenAB = ''

  const mkHost = (store: PeerStore, repos: Map<string, boolean>, onReciprocal?: PeerServerHost['registerReciprocal']): PeerServerHost =>
    createPeerServerHost({
      store, repos: createRepoHost<GitService>({ allowList: () => repos, factory: (p) => new GitService(p) }),
      version: '1.15.1', platform: 'darwin', readOnly: () => false, onReciprocal: onReciprocal as never,
    })

  beforeAll(async () => {
    repoA = await mkRepo('bidi-a-'); repoB = await mkRepo('bidi-b-')
    // a real worktree on B
    wtB = join(realpathSync(mkdtempSync(join(tmpdir(), 'bidi-wt-'))), 'feature')
    execFileSync('git', ['-C', repoB, 'worktree', 'add', wtB, '-b', 'feature'])
    const dA = mkdtempSync(join(tmpdir(), 'bidi-store-a-')), dB = mkdtempSync(join(tmpdir(), 'bidi-store-b-'))
    dirs = [repoA, repoB, wtB, dA, dB]
    storeA = new PeerStore(dA); storeB = new PeerStore(dB)
    serverA = new PeerServer(mkHost(storeA, new Map([[repoA, true]])))
    serverB = new PeerServer(mkHost(storeB, new Map([[repoB, true]]), (p) => { bLearned = p }))
    await serverA.start(PORT_A, '127.0.0.1', 5)
    await serverB.start(PORT_B, '127.0.0.1', 5)
  })
  afterAll(() => { serverA.stop(); serverB.stop(); for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

  it('one pairing ceremony gives BOTH directions', async () => {
    const selfA = { peerId: 'aaaa0000aaaa0000', name: 'Laptop A' }
    const { certPem } = await PeerConnection.probe('127.0.0.1', PORT_B)
    // A offers reciprocal credentials for its own server (pre-registered token).
    const recToken = 'cd'.repeat(32)
    const offer: PairReciprocal = { token: recToken, certPem: (await PeerConnection.probe('127.0.0.1', PORT_A)).certPem, port: PORT_A, name: 'Laptop A', addresses: ['127.0.0.1'] }
    const { token } = await PeerConnection.pair('127.0.0.1', PORT_B, serverB.code, selfA, certPem, 'desktop', undefined, offer)
    tokenAB = token
    // A recognises B when it dials back (what peer-service does after pair()):
    storeA.addPaired('bbbb0000bbbb0000'.slice(0, 16), 'B', recToken, { kind: 'desktop', readOnly: false })

    // Direction A → B (classic)
    const cAB = new PeerConnection({ peerId: 'b', name: 'B', host: '127.0.0.1', port: PORT_B, token, certPem }, selfA)
    expect(await cAB.rpc('', '__listRepos')).toEqual([{ path: repoB, name: expect.any(String), open: true }])

    // Direction B → A using ONLY what arrived in the pairing request
    expect(bLearned).not.toBeNull()
    expect(bLearned!.peerId).toBe(selfA.peerId)
    expect(bLearned!.host).toBe('127.0.0.1'); expect(bLearned!.port).toBe(PORT_A)
    const cBA = new PeerConnection({ peerId: bLearned!.peerId, name: bLearned!.name ?? 'A', host: bLearned!.host, port: bLearned!.port, token: bLearned!.token, certPem: bLearned!.certPem }, { peerId: 'bbbb0000bbbb0000', name: 'B' })
    expect(await cBA.rpc('', '__listRepos')).toEqual([{ path: repoA, name: expect.any(String), open: true }])
  })

  it('a worktree of a shared repo resolves and serves RPCs; unrelated paths still do not', async () => {
    const conn = new PeerConnection({ peerId: 'b', name: 'B', host: '127.0.0.1', port: PORT_B, token: tokenAB, certPem: (await PeerConnection.probe('127.0.0.1', PORT_B)).certPem }, { peerId: 'aaaa0000aaaa0000', name: 'A' })
    const st = await conn.rpc<{ branch: string }>(wtB, 'getStatus')
    expect(st.branch).toBe('feature')
    await expect(conn.rpc(join(tmpdir(), 'not-shared'), 'getStatus')).rejects.toThrow(/not shared/i)
  })

  it('the remote proxy translates peer-URI arguments back to host paths', async () => {
    const seen: Array<{ method: string; args: unknown[] }> = []
    const fake = { endpoint: { peerId: 'b'.repeat(16), name: 'B' }, rpc: async (_repo: string, method: string, args: unknown[]) => { seen.push({ method, args }); return null } }
    const proxy = createRemoteRepoProxy({ connection: fake as never, remotePath: '/host/repo', peerRepoPath: makePeerRepoPath('b'.repeat(16), '/host/repo') }) as unknown as { removeWorktree(p: string): Promise<unknown>; getLog(n: number): Promise<unknown> }
    await proxy.removeWorktree(makePeerRepoPath('b'.repeat(16), '/host/repo-feature'))
    await proxy.getLog(5)
    expect(seen[0]).toEqual({ method: 'removeWorktree', args: ['/host/repo-feature'] })
    expect(seen[1]).toEqual({ method: 'getLog', args: [5] })
  })

  it('canonicalPath normalises what worktree lists produce', () => {
    expect(canonicalPath(wtB + '/')).toBe(canonicalPath(wtB))
  })
})
