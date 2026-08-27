// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { encodeQr, renderQrAscii, renderQrSvg } from '../../src/main/qr'
import { pairingQrPayload, parsePairingQr } from '../../src/main/peer-protocol'

const PY = '/tmp/qrvenv/bin/python' // scratch venv with python-qrcode as a reference encoder; skipped when absent

describe('qr encoder', () => {
  it('produces square matrices with finder patterns and a dark module', () => {
    for (const text of ['A', 'gitgud-peer://pair?v=1&h=nas.tail1234.ts.net&p=47831&fp=' + 'AB'.repeat(32) + '&c=123456', 'x'.repeat(200)]) {
      const m = encodeQr(text)
      const n = m.length
      expect(n).toBeGreaterThanOrEqual(21); expect(n).toBeLessThanOrEqual(97); expect((n - 17) % 4).toBe(0)
      expect(m.every((r) => r.length === n)).toBe(true)
      expect(m[0].slice(0, 7)).toEqual([true, true, true, true, true, true, true])
      expect(m[n - 8][8]).toBe(true) // dark module
    }
    expect(() => encodeQr('x'.repeat(667))).toThrow(/too long/)
  })

  it.skipIf(!existsSync(PY))('matches the python-qrcode reference encoder bit for bit for every mask (auto version, EC M)', () => {
    // Mask *selection* is deliberately not compared: python-qrcode's penalty
    // scoring is non-standard; any of the 8 masks yields a valid symbol.
    const texts = ['hello', 'gitgud-peer://pair?v=1&h=192.168.1.20&p=47831&fp=' + 'C3'.repeat(32) + '&c=863081&alt=studio-pc.tail1234.ts.net', 'Ω'.repeat(60), 'x'.repeat(200), 'y'.repeat(214), 'gitgud-peer://pair?v=1&h=10.0.0.9&p=47831&fp=' + 'AB'.repeat(32) + '&c=123456&alt=a.tail1.ts.net,b.local&r=relay%3A%2F%2Frelay.example.com%3A47833%2F' + 'ab'.repeat(16) + '%23' + 'CD'.repeat(32) + '&n=Joe-Lloyd-V5H23GXJPK', 'z'.repeat(400), 'w'.repeat(666)]
    for (const text of texts) for (let mask = 0; mask < 8; mask++) {
      const py = `import qrcode,sys,json\nq=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M,border=0,mask_pattern=${mask})\nq.add_data(qrcode.util.QRData(sys.argv[1].encode('utf-8'),mode=qrcode.util.MODE_8BIT_BYTE))\nq.make(fit=True)\nprint(json.dumps(q.get_matrix()))`
      const ref = JSON.parse(execFileSync(PY, ['-c', py, text]).toString()) as boolean[][]
      const mine = encodeQr(text, { mask })
      expect(mine.length, `size for ${text.slice(0, 20)}`).toBe(ref.length)
      let diff = 0
      for (let r = 0; r < ref.length; r++) for (let c = 0; c < ref.length; c++) if (mine[r][c] !== ref[r][c]) diff++
      expect(diff, `differing modules for ${text.slice(0, 20)} mask ${mask}`).toBe(0)
    }
  })

  it('renders ascii (half blocks) and svg', () => {
    const a = renderQrAscii('hi')
    expect(a.split('\n').length).toBeGreaterThan(10)
    expect(/[█▀▄]/.test(a)).toBe(true)
    expect(renderQrSvg('hi')).toMatch(/^<svg .*<path d="M\d+ \d+h1v1h-1z/)
  })
})

describe('pairing QR payload', () => {
  it('round-trips and validates', () => {
    const fp = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, '0').toUpperCase()).join(':')
    const s = pairingQrPayload({ host: 'nas.tail1234.ts.net', port: 47831, fingerprint: fp, code: '123456', alts: ['192.168.1.5'], name: 'nas' })
    expect(s.startsWith('gitgud-peer://pair?v=1&')).toBe(true)
    expect(parsePairingQr(s)).toEqual({ host: 'nas.tail1234.ts.net', port: 47831, fingerprint: fp, code: '123456', alts: ['192.168.1.5'], relay: undefined, name: 'nas' })
    expect(parsePairingQr('https://example.com')).toBeNull()
    expect(parsePairingQr(s.replace('c=123456', 'c=12'))).toBeNull()
  })
})
