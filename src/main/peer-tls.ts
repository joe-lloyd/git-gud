import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign, X509Certificate, type KeyObject } from "crypto";

// TLS identity for a peer host: an EC P-256 key + self-signed X.509 cert,
// generated once in-process (no openssl shell-out, no dependency) and pinned
// by clients at pairing time (SSH known_hosts model). Chain validation on the
// client uses the pinned cert as the *only* CA plus a fingerprint check, so a
// different cert for the same address is a hard failure.
//
// The DER encoder below covers exactly the one certificate shape we emit;
// it is not a general X.509 library.

export type TlsIdentity = { keyPem: string; certPem: string; fingerprint: string };

// ── Minimal DER ─────────────────────────────────────────────────────────

function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, body: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
const seq = (...parts: Buffer[]): Buffer => tlv(0x30, Buffer.concat(parts));
const set = (...parts: Buffer[]): Buffer => tlv(0x31, Buffer.concat(parts));
const explicit = (n: number, body: Buffer): Buffer => tlv(0xa0 | n, body);
const oid = (dotted: string): Buffer => {
  const parts = dotted.split(".").map(Number);
  const out: number[] = [parts[0] * 40 + parts[1]];
  for (const p of parts.slice(2)) {
    const b: number[] = [p & 0x7f];
    for (let v = p >> 7; v > 0; v >>= 7) b.unshift(0x80 | (v & 0x7f));
    out.push(...b);
  }
  return tlv(0x06, Buffer.from(out));
};
const integer = (buf: Buffer): Buffer => tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const bool = (v: boolean): Buffer => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const utf8 = (s: string): Buffer => tlv(0x0c, Buffer.from(s, "utf8"));
const octets = (b: Buffer): Buffer => tlv(0x04, b);
const bitstring = (b: Buffer, unused = 0): Buffer => tlv(0x03, Buffer.concat([Buffer.from([unused]), b]));
const utcTime = (d: Date): Buffer => {
  const p = (n: number) => String(n).padStart(2, "0");
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(s, "ascii"));
};
const name = (cn: string): Buffer => seq(set(seq(oid("2.5.4.3"), utf8(cn))));

const OID_ECDSA_SHA256 = "1.2.840.10045.4.3.2";
const OID_BASIC_CONSTRAINTS = "2.5.29.19";
const OID_KEY_USAGE = "2.5.29.15";

function pem(label: string, der: Buffer): string {
  const b64 = der.toString("base64").replace(/(.{64})/g, "$1\n").trimEnd();
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

// ── Public API ──────────────────────────────────────────────────────────

// Self-signed EC P-256 / ECDSA-SHA256 certificate valid for ~10 years with
// CA:TRUE (so it can serve as its own trust anchor) and digitalSignature +
// keyCertSign usage. Hostname/SAN are irrelevant: clients pin the fingerprint.
export function generateSelfSigned(commonName: string, days = 3650): TlsIdentity {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const now = new Date();
  const notBefore = new Date(now.getTime() - 24 * 3600 * 1000);
  const notAfter = new Date(now.getTime() + days * 24 * 3600 * 1000);
  const algId = seq(oid(OID_ECDSA_SHA256));
  const serial = randomBytes(16);
  serial[0] &= 0x7f;

  const extensions = seq(
    seq(oid(OID_BASIC_CONSTRAINTS), bool(true), octets(seq(bool(true)))),
    // keyUsage bits: digitalSignature(0) | keyCertSign(5) → 1000 0100, 2 unused
    seq(oid(OID_KEY_USAGE), bool(true), octets(bitstring(Buffer.from([0x84]), 2))),
  );

  const tbs = seq(
    explicit(0, integer(Buffer.from([2]))), // v3
    integer(serial),
    algId,
    name(commonName),
    seq(utcTime(notBefore), utcTime(notAfter)),
    name(commonName),
    publicKey.export({ type: "spki", format: "der" }) as Buffer,
    explicit(3, extensions),
  );
  const signature = sign("sha256", tbs, privateKey); // DER-encoded ECDSA sig
  const cert = seq(tbs, algId, bitstring(signature));

  const certPem = pem("CERTIFICATE", cert);
  return {
    keyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    certPem,
    fingerprint: certFingerprint(certPem),
  };
}

// SHA-256 over the DER certificate, formatted like Node's
// `fingerprint256` (AA:BB:…) so both sides compare the same string.
export function certFingerprint(certPemOrDer: string | Buffer): string {
  const der = typeof certPemOrDer === "string" ? pemToDer(certPemOrDer) : certPemOrDer;
  return createHash("sha256").update(der).digest("hex").toUpperCase().match(/.{2}/g)!.join(":");
}

export function pemToDer(p: string): Buffer {
  return Buffer.from(p.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
}

// Short human-readable form for UIs: first 8 bytes grouped in fours.
export function shortFingerprint(fp: string): string {
  const hex = fp.replace(/:/g, "");
  return hex.slice(0, 16).match(/.{4}/g)!.join(" ");
}

// Sanity-check a stored identity still parses and is self-consistent —
// regenerate if it doesn't (corrupt file, future format change).
export function validateIdentity(id: { keyPem: string; certPem: string }): boolean {
  try {
    const cert = new X509Certificate(id.certPem);
    const pub: KeyObject = createPublicKey(id.keyPem);
    if (!cert.verify(pub)) return false;
    return new Date(cert.validTo).getTime() > Date.now() + 24 * 3600 * 1000;
  } catch {
    return false;
  }
}
