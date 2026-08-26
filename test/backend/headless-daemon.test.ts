// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import simpleGit from 'simple-git'
import { startDaemon, type RunningDaemon } from '../../src/headless/daemon'
import { DEFAULT_CONFIG } from '../../src/headless/config'
import { createLogger } from '../../src/headless/log'
import { controlRequest } from '../../src/headless/control'
import { PeerConnection } from '../../src/main/peer-client'

// The daemon end to end, in-process: config → serve → CLI-style pairing via
// the control socket → a real PeerConnection pairs, reads, is refused writes
// (read-only default), then allowed after a config flip + reload.
describe('gitgud-headless daemon', () => {
  let home: string, repo: string, d: RunningDaemon
  const lines: string[] = []
  const self = { peerId: 'd0d0d0d0d0d0d0d0', name: 'Laptop' }
  let cfg = { ...DEFAULT_CONFIG }

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'gg-headless-'))
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'gg-hrepo-')))
    const g = simpleGit(repo)
    await g.init(['-b', 'main'] as any); await g.addConfig('user.name', 'T'); await g.addConfig('user.email', 't@t.t')
    writeFileSync(join(repo, 'a.txt'), 'a\n'); await g.add('.'); await g.commit('first')
    cfg = { ...DEFAULT_CONFIG, name: 'nas', port: 47960, bind: '127.0.0.1', repos: [repo], pairingWindowMinutes: 1 }
    const paths = { configDir: home, dataDir: join(home, 'data'), stateDir: join(home, 'state'), runtimeDir: join(home, 'run') }
    d = await startDaemon({ paths, version: '9.9.9', log: createLogger({ sink: (l) => lines.push(l) }), config: cfg })
  })
  afterAll(async () => { await d.stop(); rmSync(home, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }) })

  it('serves on the configured bind/port with platform linux-headless and reports read-only', async () => {
    expect(d.bindAddress).toBe('127.0.0.1'); expect(d.port).toBe(47960)
    const { info } = await PeerConnection.probe('127.0.0.1', d.port)
    expect(info).toMatchObject({ name: 'nas', platform: 'linux-headless', version: '9.9.9', readOnly: true, fingerprint: d.fingerprint })
  })

  it('pairing is closed until the CLI asks for a code (control socket), then one code = one pairing', async () => {
    await expect(PeerConnection.pair('127.0.0.1', d.port, d.server.code, self, (await PeerConnection.probe('127.0.0.1', d.port)).certPem)).rejects.toThrow(/Pairing is closed/)
    const r = (await controlRequest(d.socketPath, { cmd: 'pair' })) as { code: string; fingerprint: string; addresses: string[] }
    expect(r.code).toMatch(/^\d{6}$/); expect(r.fingerprint).toBe(d.fingerprint); expect(r.addresses[0]).toBe(`127.0.0.1:${d.port}`)
    const certPem = (await PeerConnection.probe('127.0.0.1', d.port)).certPem
    const paired = await PeerConnection.pair('127.0.0.1', d.port, r.code, self, certPem)
    expect(paired.readOnly).toBe(true)
    // window consumed → closed again
    await expect(PeerConnection.pair('127.0.0.1', d.port, d.server.code, { peerId: 'e1e1e1e1e1e1e1e1', name: 'x' }, certPem)).rejects.toThrow(/Pairing is closed/)
    const status = (await controlRequest(d.socketPath, { cmd: 'status' })) as { paired: Array<{ name: string }>; pairingOpen: boolean }
    expect(status.paired.map((p) => p.name)).toEqual(['Laptop']); expect(status.pairingOpen).toBe(false)
    ;(globalThis as any).__token = paired.token; (globalThis as any).__cert = certPem
  })

  it('reads work, writes are refused while read-only, allowed after reload with readOnly=false, deny-list still holds', async () => {
    const conn = new PeerConnection({ peerId: d.peerId, name: 'nas', host: '127.0.0.1', port: d.port, token: (globalThis as any).__token, certPem: (globalThis as any).__cert }, self)
    expect(await conn.listRepos()).toEqual([{ path: repo, name: repo.split('/').pop(), open: true }])
    const log = await conn.rpc<Array<{ message: string }>>(repo, 'getLog', [10]); expect(log[0].message).toBe('first')
    await expect(conn.rpc(repo, 'createBranch', ['feat'])).rejects.toMatchObject({ code: 'read-only' })
    cfg.readOnly = false; d.reload()
    await conn.rpc(repo, 'createBranch', ['feat'])
    const br = await conn.rpc<{ local: Array<{ name: string }> }>(repo, 'getBranches', []); expect(br.local.map((b) => b.name).sort()).toEqual(['feat', 'main'])
    await expect(conn.rpc(repo, 'setConfig', ['core.hooksPath', '/tmp/evil'])).rejects.toThrow(/disabled by policy/)
    await expect(conn.rpc('/etc', 'getLog', [1])).rejects.toMatchObject({ code: 'forbidden-repo' })
    conn.disconnect()
  })

  it('devices / revoke via control socket; revoked token → 401', async () => {
    const ds = (await controlRequest(d.socketPath, { cmd: 'devices' })) as Array<{ peerId: string; readOnly: boolean }>
    expect(ds).toHaveLength(1); expect(ds[0].readOnly).toBe(false)
    expect(await controlRequest(d.socketPath, { cmd: 'revoke', peerId: self.peerId })).toEqual({ revoked: true })
    const conn = new PeerConnection({ peerId: d.peerId, name: 'nas', host: '127.0.0.1', port: d.port, token: (globalThis as any).__token, certPem: (globalThis as any).__cert }, self)
    await expect(conn.rpc(repo, 'getLog', [1])).rejects.toMatchObject({ code: 'unauthorized' })
    expect(lines.some((l) => /paired/.test(l))).toBe(true)
  })
})
