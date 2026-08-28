// Read-only peer client for the companion app. Mirrors src/main/peer-client.ts
// on the desktop but only speaks READ_METHODS + the host-level `__` methods,
// pins the certificate from the QR *before* the first request (no TOFU) and
// keeps SSE to the foreground.
import {
  DEFAULT_SERVER_PORT, READ_METHODS, SseParser, parseRelayUrl, relaySniHost,
  type PairResponse, type PeerEvent, type PeerInfo, type PeerRepoSummary, type RpcErrorCode, type RpcResponse,
} from '@gitgud/peer-protocol'
import { pairingProof, randomHex } from './sha256'
import { TransportError, type PinnedTransport } from './transport'

// One way to reach a host. `relay` set → TCP to the relay, TLS SNI = `host`
// (`<peerId>.gitgud-relay`), certificate pin still the host's.
export type Address = { host: string; port: number; relay?: { host: string; port: number } }

export type Machine = {
  peerId: string
  name: string
  // Addresses in preference order (LAN, tailnet name, relay last); the first
  // that answers becomes `lastGood`. Direct ones are retried before the relay.
  addresses: Address[]
  lastGood?: Address
  fingerprint: string
  token: string
  readOnly: boolean
  // Write methods the host lets this (read-only) phone run — tap-to-approve.
  scopes?: string[]
  platform: string
  version: string
  pairedAt: number
}

export type Self = { peerId: string; name: string }

export class RpcError extends Error {
  constructor(message: string, public code: RpcErrorCode | 'network' | 'timeout' | 'tls') { super(message); this.name = 'RpcError' }
}

const PROBE_TIMEOUT = 5_000
const RPC_TIMEOUT = 60_000

export function newSelf(name: string): Self { return { peerId: randomHex(16), name } }

export class PeerClient {
  private seq = 0
  constructor(private t: PinnedTransport, public self: Self) {}

  private base(a: Address) { return `https://${a.host}:${a.port}/gitgud` }
  private hop(a: Address) { return a.relay ? { viaRelay: a.relay } : {} }

  // /info with the QR's fingerprint already pinned.
  async probe(a: Address, fingerprint: string): Promise<PeerInfo> {
    const r = await this.t.request(`${this.base(a)}/info`, { method: 'GET', fingerprint, timeoutMs: PROBE_TIMEOUT, ...this.hop(a) })
    if (r.status !== 200) throw new RpcError(`Host answered ${r.status}`, 'network')
    const info = JSON.parse(r.body) as PeerInfo
    if (!info || typeof info.peerId !== 'string') throw new RpcError('Not a Git Gud host', 'network')
    if (info.fingerprint && info.fingerprint.replace(/:/g, '').toUpperCase() !== fingerprint.replace(/:/g, '').toUpperCase()) throw new RpcError('Certificate mismatch', 'tls')
    return info
  }

  // Try each address until one answers; returns the address + info.
  async probeAny(addresses: Address[], fingerprint: string): Promise<{ address: Address; info: PeerInfo }> {
    let last: unknown = null
    for (const address of addresses) {
      try { return { address, info: await this.probe(address, fingerprint) } } catch (e) { last = e; if ((e as RpcError).code === 'tls') throw e }
    }
    throw last ?? new RpcError('No address answered', 'network')
  }

  async pair(a: Address, fingerprint: string, code: string): Promise<{ token: string; peer: PeerInfo; readOnly: boolean }> {
    const body = JSON.stringify({ proof: pairingProof(code, fingerprint), peerId: this.self.peerId, name: this.self.name, kind: 'companion' })
    const r = await this.t.request(`${this.base(a)}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, fingerprint, timeoutMs: PROBE_TIMEOUT, ...this.hop(a) })
    let res: PairResponse | null = null
    try { res = JSON.parse(r.body) as PairResponse } catch { /* below */ }
    if (!res) throw new RpcError(`Pairing failed (${r.status})`, 'network')
    if (!res.ok) throw new RpcError(res.error, 'failed')
    return { token: res.token, peer: res.peer, readOnly: res.readOnly === true }
  }

  async rpc<T = unknown>(m: Machine, repoPath: string, method: string, args: unknown[] = []): Promise<T> {
    if (!method.startsWith('__') && !READ_METHODS.has(method) && !(m.scopes ?? []).includes(method)) throw new RpcError(`"${method}" is not allowed for this phone — the host's owner can grant fetch/pull in Settings → Paired devices`, 'read-only')
    const a = m.lastGood ?? m.addresses[0]
    const id = String(++this.seq)
    let r
    try {
      r = await this.t.request(`${this.base(a)}/rpc`, {
        method: 'POST', fingerprint: m.fingerprint, timeoutMs: RPC_TIMEOUT, ...this.hop(a),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m.token}` },
        body: JSON.stringify({ id, repoPath, method, args }),
      })
    } catch (e) {
      if (e instanceof TransportError) throw new RpcError(e.message, e.code)
      throw new RpcError(String(e), 'network')
    }
    let res: RpcResponse | null = null
    try { res = JSON.parse(r.body) as RpcResponse } catch { /* below */ }
    if (!res) throw new RpcError(`Bad response (${r.status})`, 'network')
    if (!res.ok) throw new RpcError(res.error, res.code ?? 'failed')
    return res.result as T
  }

  listRepos(m: Machine): Promise<PeerRepoSummary[]> { return this.rpc(m, '', '__listRepos') }
  whoami(m: Machine): Promise<{ peerId: string; name: string; kind: string; readOnly: boolean; scopes?: string[] }> { return this.rpc(m, '', '__whoami') }
  // Scoped writes (host-approved, tap-to-approve in the UI). The host forces
  // the safe variants for companion devices too: pull is --ff-only, push is
  // never forced — so a phone can only ever move refs forward.
  fetch(m: Machine, repoPath: string): Promise<null> { return this.rpc(m, repoPath, 'fetch') }
  pull(m: Machine, repoPath: string): Promise<{ success: boolean; error?: string; kind?: string }> { return this.rpc(m, repoPath, 'pull', [{ ffOnly: true }]) }
  push(m: Machine, repoPath: string): Promise<{ success: boolean; error?: string }> { return this.rpc(m, repoPath, 'push', [false]) }
  subscribePush(m: Machine, token: string, events: string[]): Promise<{ subscribed: boolean }> { return this.rpc(m, '', '__subscribePush', [{ token, events }]) }

  // Foreground-only event stream for one or more repos.
  events(m: Machine, repos: string[], onEvent: (ev: PeerEvent) => void, onClose: (err?: Error) => void): () => void {
    const a = m.lastGood ?? m.addresses[0]
    const parser = new SseParser()
    return this.t.stream(`${this.base(a)}/events?repos=${repos.map(encodeURIComponent).join(',')}`, {
      headers: { Authorization: `Bearer ${m.token}` }, fingerprint: m.fingerprint, ...this.hop(a),
      onChunk: (text) => { for (const ev of parser.feed(text)) onEvent(ev) },
      onClose,
    })
  }
}

/** `relay://host:port/<peerId>#fp` → the Address the phone dials (SNI-routed through the relay). */
export function relayAddress(route: string | undefined, peerId: string): Address | null {
  if (!route) return null
  const r = parseRelayUrl(route.startsWith('relay://') ? route : `relay://${route}`)
  if (!r) return null
  return { host: relaySniHost(r.peerId ?? peerId), port: r.port, relay: { host: r.host, port: r.port } }
}

/** Direct addresses from the QR first, the relay route (from the QR or the host's /info) last. */
export function addressesFor(qr: { host: string; port: number; alts?: string[]; relay?: string }, peer: PeerInfo): Address[] {
  const out: Address[] = [{ host: qr.host, port: qr.port }, ...(qr.alts ?? []).map((h) => ({ host: h, port: qr.port || DEFAULT_SERVER_PORT }))]
  const relay = relayAddress(peer.relay ?? qr.relay, peer.peerId)
  if (relay) out.push(relay)
  return out
}

/** Merge a relay route the host advertised in /info into a stored machine; returns the new list or null when unchanged. */
export function withRelay(addresses: Address[], route: string | undefined, peerId: string): Address[] | null {
  const relay = relayAddress(route, peerId)
  if (!relay) return null
  const rest = addresses.filter((a) => !a.relay)
  const had = addresses.find((a) => a.relay)
  if (had && had.relay!.host === relay.relay!.host && had.relay!.port === relay.relay!.port) return null
  return [...rest, relay]
}

export function machineFromPairing(qr: { host: string; port: number; fingerprint: string; alts?: string[]; name?: string; relay?: string }, peer: PeerInfo, token: string, readOnly: boolean): Machine {
  const addresses = addressesFor(qr, peer)
  return { peerId: peer.peerId, name: peer.name || qr.name || qr.host, addresses, lastGood: addresses[0], fingerprint: peer.fingerprint || qr.fingerprint, token, readOnly, platform: peer.platform, version: peer.version, pairedAt: Date.now() }
}
