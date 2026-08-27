// Minimal PNG writer for QR matrices (8-bit grayscale, zlib via node:zlib).
// Zero dependencies — used by scripts/release-qr.ts to publish an "install
// the companion app" QR image next to each GitHub Release.
import { deflateSync } from "zlib";
import { encodeQr, type QrMatrix } from "./qr";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, Buffer.from(data)])));
  return Buffer.concat([len, typeBuf, Buffer.from(data), crc]);
}

/** Encode a boolean matrix as a grayscale PNG; each module becomes `scale`×`scale` pixels with a `quiet` module border. */
export function matrixToPng(m: QrMatrix, opts: { scale?: number; quiet?: number } = {}): Buffer {
  const scale = Math.max(1, Math.floor(opts.scale ?? 8));
  const quiet = Math.max(0, Math.floor(opts.quiet ?? 4));
  const n = m.length;
  const cells = n + quiet * 2;
  const size = cells * scale;
  // Each scanline: 1 filter byte + `size` gray bytes.
  const raw = Buffer.alloc((size + 1) * size, 0xff);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!m[r][c]) continue;
      for (let dy = 0; dy < scale; dy++) {
        const y = (r + quiet) * scale + dy;
        const rowStart = y * (size + 1) + 1;
        const x0 = (c + quiet) * scale;
        raw.fill(0x00, rowStart + x0, rowStart + x0 + scale);
      }
    }
  }
  for (let y = 0; y < size; y++) raw[y * (size + 1)] = 0; // filter type 0 per row
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // compression, filter, interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

export function renderQrPng(text: string, opts: { scale?: number; quiet?: number } = {}): Buffer {
  return matrixToPng(encodeQr(text), opts);
}
