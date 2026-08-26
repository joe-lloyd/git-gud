import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { encodeBeaconString, parseBeacon as parseBeaconText, type Beacon } from "@gitgud/peer-protocol";

// Node side of the peer protocol. The wire protocol itself (types, allow-
// lists, URIs, SSE parser, QR payload…) is the shared pure package
// `@gitgud/peer-protocol` (packages/peer-protocol) so the daemon and the
// companion app agree with the desktop byte for byte. This file adds the
// pieces that need Node crypto / Buffer and re-exports the rest so every
// existing `./peer-protocol` import keeps working.
export * from "@gitgud/peer-protocol";

// ── Pairing / tokens ────────────────────────────────────────────────────

export function generatePairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function generatePeerId(): string {
  return randomBytes(16).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// Binds a pairing attempt to the certificate the client actually connected
// to: HMAC-SHA256(key = pairing code, message = cert fingerprint). The host
// recomputes it with its own code + fingerprint; a MITM with a different
// cert cannot produce a matching proof even if it captured the code.
export function pairingProof(code: string, fingerprint: string): string {
  return createHmac("sha256", code).update(fingerprint.toUpperCase(), "utf8").digest("hex");
}

// Constant-time string compare — pairing codes and token hashes.
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ── Discovery beacon (Buffer flavour for dgram) ─────────────────────────

export function encodeBeacon(b: Omit<Beacon, "t" | "v">): Buffer {
  return Buffer.from(encodeBeaconString(b), "utf8");
}

export function parseBeacon(buf: Buffer | string): Beacon | null {
  return parseBeaconText(typeof buf === "string" ? buf : buf.toString("utf8"));
}
