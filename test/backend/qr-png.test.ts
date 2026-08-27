// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { inflateSync } from 'zlib'
import { crc32, matrixToPng, renderQrPng } from '../../src/main/qr-png'
import { encodeQr } from '../../src/main/qr'

describe('qr png renderer', () => {
  it('crc32 matches the reference value for "123456789"', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
  })

  it('emits a well-formed grayscale PNG whose pixels mirror the matrix', () => {
    const url = 'https://github.com/joe-lloyd/git-gud/releases/download/v1.13.0/Git-Gud-Companion-1.13.0.apk'
    const m = encodeQr(url)
    const png = renderQrPng(url, { scale: 2, quiet: 1 })
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(png.toString('ascii', 12, 16)).toBe('IHDR')
    const size = (m.length + 2) * 2
    expect(png.readUInt32BE(16)).toBe(size)
    expect(png.readUInt32BE(20)).toBe(size)
    expect(png[24]).toBe(8)
    expect(png[25]).toBe(0)
    // IDAT follows IHDR (8 sig + 4 len + 4 type + 13 data + 4 crc = 33)
    const idatLen = png.readUInt32BE(33)
    expect(png.toString('ascii', 37, 41)).toBe('IDAT')
    const raw = inflateSync(png.subarray(41, 41 + idatLen))
    expect(raw.length).toBe((size + 1) * size)
    // top-left module of the finder pattern is dark → pixel at (quiet*scale, quiet*scale) is 0
    const px = (x: number, y: number) => raw[y * (size + 1) + 1 + x]
    expect(px(2, 2)).toBe(0)
    expect(px(0, 0)).toBe(0xff) // quiet zone
    expect(m[0][0]).toBe(true)
    expect(png.toString('ascii', png.length - 8, png.length - 4)).toBe('IEND')
  })

  it('scale and quiet zone control the pixel size', () => {
    const m = [[true, false], [false, true]]
    const png = matrixToPng(m, { scale: 3, quiet: 0 })
    expect(png.readUInt32BE(16)).toBe(6)
  })
})
