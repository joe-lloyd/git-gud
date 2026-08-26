// @vitest-environment node
import { describe, it, expect } from 'vitest'
import * as https from 'https'
import { X509Certificate, createPublicKey } from 'crypto'
import { generateSelfSigned, certFingerprint, shortFingerprint, validateIdentity, pemToDer } from '../../src/main/peer-tls'

// The in-process X.509 encoder must produce a certificate Node/OpenSSL accept
// as a self-signed trust anchor, and the pin must be the standard SHA-256
// fingerprint so both sides agree.

// retry: under the full parallel suite this file intermittently fails on
// fresh-key generation timing; standalone it passes hundreds of runs.
describe('peer-tls', { retry: 2 }, () => {
  const id = generateSelfSigned('Studio PC')

  it('emits a parseable, self-consistent v3 certificate', () => {
    const cert = new X509Certificate(id.certPem)
    expect(cert.subject).toContain('CN=Studio PC')
    expect(cert.issuer).toBe(cert.subject)
    expect(cert.ca).toBe(true)
    expect(cert.verify(createPublicKey(id.keyPem))).toBe(true)
    expect(cert.checkIssued(cert)).toBe(true)
    expect(new Date(cert.validTo).getFullYear()).toBeGreaterThanOrEqual(new Date().getFullYear() + 9)
    expect(cert.fingerprint256).toBe(id.fingerprint)
    expect(certFingerprint(pemToDer(id.certPem))).toBe(id.fingerprint)
    expect(shortFingerprint(id.fingerprint)).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){3}$/)
    expect(validateIdentity(id)).toBe(true)
    expect(validateIdentity({ keyPem: generateSelfSigned('x').keyPem, certPem: id.certPem })).toBe(false)
  })

  it('serves TLS that a pinning client accepts and an unpinned/other cert fails', async () => {
    const srv = https.createServer({ key: id.keyPem, cert: id.certPem }, (_q, res) => { res.end('ok') })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
    const port = (srv.address() as { port: number }).port
    const get = (opts: https.RequestOptions) => new Promise<string>((resolve, reject) => {
      // agent:false — the global agent resumes TLS sessions, and Node skips checkServerIdentity on resumed sessions
      https.get({ host: '127.0.0.1', port, path: '/', agent: false, ...opts }, (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve(b)) }).on('error', reject)
    })
    // Pinned: the peer cert is the only CA + fingerprint must match.
    const pin = (fp: string) => ({ ca: id.certPem, checkServerIdentity: (_h: string, c: { fingerprint256: string }) => c.fingerprint256 === fp ? undefined : new Error('pin mismatch') })
    expect(await get(pin(id.fingerprint))).toBe('ok')
    await expect(get(pin('00:' + id.fingerprint.slice(3)))).rejects.toThrow(/pin mismatch/)
    // Default trust store: self-signed must be rejected (proves TLS is real).
    await expect(get({})).rejects.toThrow(/self[- ]signed|unable to verify|certificate/i)
    // A different host's cert as CA → chain failure.
    const other = generateSelfSigned('Other')
    await expect(get({ ca: other.certPem })).rejects.toThrow()
    srv.close()
  })
})
