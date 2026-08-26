// Minimal QR code encoder (ISO/IEC 18004): byte mode, versions 1–10, error
// correction level M, all 8 masks with penalty scoring. Zero dependencies.
// Used for pairing: the host renders the payload (address + fingerprint +
// code) as a QR the companion app scans, so nothing has to be typed or
// eyeballed. Output is a boolean matrix; renderers below turn it into ASCII
// (terminal) or SVG (desktop).

export type QrMatrix = boolean[][];

// ── Tables (versions 1–10, EC level M) ──────────────────────────────────
// [total codewords, EC codewords per block, blocks group1, data cw group1, blocks group2, data cw group2]
const EC_M: Array<[number, number, number, number, number, number]> = [
  [26, 10, 1, 16, 0, 0],
  [44, 16, 1, 28, 0, 0],
  [70, 26, 1, 44, 0, 0],
  [100, 18, 2, 32, 0, 0],
  [134, 24, 2, 43, 0, 0],
  [172, 16, 4, 27, 0, 0],
  [196, 18, 4, 31, 0, 0],
  [242, 22, 2, 38, 2, 39],
  [292, 22, 3, 36, 2, 37],
  [346, 26, 4, 43, 1, 44],
];
const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// ── GF(256) ─────────────────────────────────────────────────────────────
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsGenerator(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); }
    g = next;
  }
  return g;
}
export function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen);
  const out = new Array(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ out[0];
    out.shift(); out.push(0);
    if (factor) for (let i = 0; i < ecLen; i++) out[i] ^= mul(gen[i + 1], factor);
  }
  return out;
}

// ── Encode ──────────────────────────────────────────────────────────────
// Data + EC codewords in final (interleaved) order, plus the version index.
export function buildCodewords(text: string): { version: number; seq: number[] } {
  const bytes = [...Buffer.from(text, "utf8")];
  let version = -1;
  for (let v = 0; v < EC_M.length; v++) {
    const [total, ec, b1, , b2] = EC_M[v];
    const dataCw = total - ec * (b1 + b2);
    const need = 4 + (v + 1 < 10 ? 8 : 16) + bytes.length * 8;
    if (need <= dataCw * 8) { version = v; break; }
  }
  if (version < 0) throw new Error(`QR payload too long (${bytes.length} bytes; max 213 at version 10-M)`);

  const [total, ecPerBlock, b1, d1, b2, d2] = EC_M[version];
  const dataCw = total - ecPerBlock * (b1 + b2);
  const bits: number[] = [];
  const push = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version + 1 < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  for (let i = 0; i < 4 && bits.length < dataCw * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < dataCw; pad ^= 0xfd) data.push(pad);

  const blocks: number[][] = []; const ecs: number[][] = [];
  let off = 0;
  for (let i = 0; i < b1; i++) { const blk = data.slice(off, off + d1); off += d1; blocks.push(blk); ecs.push(rsEncode(blk, ecPerBlock)); }
  for (let i = 0; i < b2; i++) { const blk = data.slice(off, off + d2); off += d2; blocks.push(blk); ecs.push(rsEncode(blk, ecPerBlock)); }
  const seq: number[] = [];
  const maxD = Math.max(d1, d2);
  for (let i = 0; i < maxD; i++) for (const blk of blocks) if (i < blk.length) seq.push(blk[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const e of ecs) seq.push(e[i]);
  return { version, seq };
}

export function encodeQr(text: string, opts: { mask?: number } = {}): QrMatrix {
  const { version, seq } = buildCodewords(text);
  // Matrix
  const size = 17 + 4 * (version + 1);
  const m: (boolean | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));
  const setFn = (r: number, c: number, v: boolean) => { if (r >= 0 && r < size && c >= 0 && c < size) m[r][c] = v; };
  const finder = (r: number, c: number) => {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const on = inside && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
      setFn(r + dr, c + dc, on);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { m[6][i] = i % 2 === 0; m[i][6] = i % 2 === 0; }
  const ap = ALIGN[version];
  for (const r of ap) for (const c of ap) {
    // Skip only the three that would sit on a finder pattern; the ones on
    // the timing row/column are real and overwrite the timing modules.
    if ((r < 9 && c < 9) || (r < 9 && c > size - 9) || (r > size - 9 && c < 9)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) setFn(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  m[size - 8][8] = true; // dark module
  // Reserve format areas
  for (let i = 0; i < 8; i++) { if (m[8][i] === null) m[8][i] = false; if (m[i][8] === null) m[i][8] = false; if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = false; if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = false; }
  if (m[8][8] === null) m[8][8] = false;
  // Version information (versions ≥ 7): 6-bit version + 12-bit BCH, placed
  // twice (below the top-right finder and right of the bottom-left one).
  if (version + 1 >= 7) {
    const ver = version + 1;
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vbits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vbits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      m[a][b] = bit; m[b][a] = bit;
    }
  }
  const reserved: boolean[][] = m.map((row) => row.map((v) => v !== null));

  // Place data (zig-zag, right to left, skipping column 6)
  let bitIdx = 0; const totalBits = seq.length * 8;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < size; k++) {
      const row = upward ? size - 1 - k : k;
      for (const c of [col, col - 1]) {
        if (m[row][c] !== null) continue;
        const bit = bitIdx < totalBits ? (seq[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1 : 0;
        m[row][c] = bit === 1; bitIdx++;
      }
    }
    upward = !upward;
  }

  // Mask selection
  const MASKS: Array<(r: number, c: number) => boolean> = [
    (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (_r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];
  let best: QrMatrix = []; let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    if (opts.mask !== undefined && mask !== opts.mask) continue;
    const g: QrMatrix = m.map((row, r) => row.map((v, c) => (reserved[r][c] ? !!v : (v as boolean) !== MASKS[mask](r, c))));
    writeFormat(g, size, mask);
    const score = penalty(g);
    if (score < bestScore) { bestScore = score; best = g; }
  }
  return best;
}

function writeFormat(g: QrMatrix, size: number, mask: number): void {
  // EC level M = 00
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) & 1 ? 0x537 : 0);
  const bitsVal = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bitsVal >> i) & 1) === 1;
  for (let i = 0; i < 6; i++) g[8][i] = bit(14 - i);
  g[8][7] = bit(8); g[8][8] = bit(7); g[7][8] = bit(6);
  for (let i = 0; i < 6; i++) g[5 - i][8] = bit(5 - i);
  // Second copy: bits 0–7 along row 8 (right edge), bits 8–14 down column 8
  // (bottom edge); (size-8, 8) is the always-dark module.
  for (let i = 0; i < 8; i++) g[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) g[size - 15 + i][8] = bit(i);
  g[size - 8][8] = true;
}

function penalty(g: QrMatrix): number {
  const n = g.length; let score = 0;
  const runs = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < n; i++) {
      let run = 1;
      for (let j = 1; j <= n; j++) {
        if (j < n && get(i, j) === get(i, j - 1)) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
    }
  };
  runs((i, j) => g[i][j]); runs((i, j) => g[j][i]);
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) { const v = g[r][c]; if (v === g[r][c + 1] && v === g[r + 1][c] && v === g[r + 1][c + 1]) score += 3; }
  const pat = [true, false, true, true, true, false, true];
  const finderLike = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < n; i++) for (let j = 0; j <= n - 7; j++) {
      let ok = true; for (let k = 0; k < 7; k++) if (get(i, j + k) !== pat[k]) { ok = false; break; }
      if (!ok) continue;
      const before = j >= 4 && [0, 1, 2, 3].every((k) => !get(i, j - 1 - k));
      const after = j + 10 < n && [0, 1, 2, 3].every((k) => !get(i, j + 7 + k));
      if (before || after) score += 40;
    }
  };
  finderLike((i, j) => g[i][j]); finderLike((i, j) => g[j][i]);
  let dark = 0; for (const row of g) for (const v of row) if (v) dark++;
  const pct = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

// ── Renderers ───────────────────────────────────────────────────────────

// Two rows per text line using half-block glyphs; dark = "on" modules.
// Terminals show dark text on light or light on dark, so we render modules
// as the *foreground* and rely on the quiet zone for contrast either way.
export function renderQrAscii(text: string, quiet = 2): string {
  const m = encodeQr(text);
  const n = m.length;
  const at = (r: number, c: number) => r >= 0 && r < n && c >= 0 && c < n && m[r][c];
  const lines: string[] = [];
  for (let r = -quiet; r < n + quiet; r += 2) {
    let line = "";
    for (let c = -quiet; c < n + quiet; c++) {
      const top = at(r, c), bot = at(r + 1, c);
      line += top && bot ? "█" : top ? "▀" : bot ? "▄" : " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export function renderQrSvg(text: string, opts: { size?: number; quiet?: number; dark?: string; light?: string } = {}): string {
  const m = encodeQr(text);
  const n = m.length, q = opts.quiet ?? 3, size = opts.size ?? 256;
  const cells = n + q * 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) d += `M${c + q} ${r + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cells} ${cells}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${cells}" height="${cells}" fill="${opts.light ?? "#fff"}"/><path d="${d}" fill="${opts.dark ?? "#000"}"/></svg>`;
}
