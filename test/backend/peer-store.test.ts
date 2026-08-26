import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PeerStore, type Crypter } from '../../src/main/peer-store'
import { hashToken } from '../../src/main/peer-protocol'

// A fake "encryption" that is trivially detectable so the test can prove the
// known-peers file never holds plaintext tokens.
const xorCrypter: Crypter = {
  encrypt: (s) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
  decrypt: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8'),
}

describe('PeerStore', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'peer-store-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('creates a stable identity and sane defaults', () => {
    const a = new PeerStore(dir)
    const id = a.getIdentity()
    expect(id.peerId).toMatch(/^[0-9a-f]{32}$/)
    expect(id.name.length).toBeGreaterThan(0)
    const b = new PeerStore(dir)
    expect(b.getIdentity().peerId).toBe(id.peerId)
    expect(b.getSettings()).toEqual({ enabled: false, port: 47831, name: id.name, readOnly: false, push: false })
  })

  it('validates settings patches', () => {
    const s = new PeerStore(dir)
    s.updateSettings({ enabled: true, port: 80, name: '   ', readOnly: true })
    expect(s.getSettings()).toMatchObject({ enabled: true, port: 47831, readOnly: true }) // port <1024 rejected, blank name ignored
    s.updateSettings({ port: 50000, name: '  Studio PC  ' })
    expect(s.getSettings().port).toBe(50000)
    expect(s.getIdentity().name).toBe('Studio PC')
    expect(new PeerStore(dir).getSettings().port).toBe(50000)
  })

  it('stores only token hashes for paired devices and finds them by raw token', () => {
    const s = new PeerStore(dir)
    s.addPaired('aaaa1111', 'Laptop', 'tok-1')
    s.addPaired('bbbb2222', 'Desktop', 'tok-2')
    expect(s.findByToken('tok-1')?.name).toBe('Laptop')
    expect(s.findByToken('nope')).toBeNull()
    const raw = readFileSync(join(dir, 'peer-paired.json'), 'utf8')
    expect(raw).not.toContain('tok-1')
    expect(raw).toContain(hashToken('tok-1'))
    // re-pair replaces the token
    s.addPaired('aaaa1111', 'Laptop', 'tok-3')
    expect(s.findByToken('tok-1')).toBeNull()
    expect(s.findByToken('tok-3')?.peerId).toBe('aaaa1111')
    expect(s.listPaired()).toHaveLength(2)
    expect(s.revokePaired('bbbb2222')).toBe(true)
    expect(s.revokePaired('bbbb2222')).toBe(false)
    expect(s.findByToken('tok-2')).toBeNull()
  })

  it('encrypts known peers at rest and round-trips them', () => {
    const s = new PeerStore(dir, xorCrypter)
    s.upsertKnown({ peerId: 'cccc3333', name: 'Win box', host: '192.168.1.9', port: 47831, token: 'secret-token', certPem: '-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----\n' })
    const file = join(dir, 'peer-known.json')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file).toString('utf8')).not.toContain('secret-token')
    const again = new PeerStore(dir, xorCrypter)
    expect(again.getKnown('cccc3333')).toMatchObject({ name: 'Win box', host: '192.168.1.9', token: 'secret-token' })
    again.touchKnown('cccc3333', { host: '192.168.1.42', name: 'Win box 2' })
    expect(new PeerStore(dir, xorCrypter).getKnown('cccc3333')).toMatchObject({ host: '192.168.1.42', name: 'Win box 2', token: 'secret-token' })
    expect(again.forgetKnown('cccc3333')).toBe(true)
    expect(again.listKnown()).toEqual([])
  })

  it('generates a TLS identity once and reuses it', () => {
    const a = new PeerStore(dir)
    const t1 = a.getTls()
    expect(t1.certPem).toContain('BEGIN CERTIFICATE')
    expect(t1.keyPem).toContain('PRIVATE KEY')
    expect(t1.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
    expect(new PeerStore(dir).getTls().fingerprint).toBe(t1.fingerprint)
    expect(existsSync(join(dir, 'peer-tls-key.pem'))).toBe(true)
  })

  it('survives a corrupt known-peers file', () => {
    const s = new PeerStore(dir, xorCrypter)
    s.upsertKnown({ peerId: 'cccc3333', name: 'x', host: 'h', port: 1, token: 't', certPem: '-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----\n' })
    // Read with the wrong crypter → garbage → empty list, no throw.
    expect(new PeerStore(dir).listKnown()).toEqual([])
  })
})
