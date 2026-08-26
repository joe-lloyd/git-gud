// Read-only peer client for the companion app. Mirrors src/main/peer-client.ts
// on the desktop but only speaks READ_METHODS + the host-level `__` methods,
// pins the certificate from the QR *before* the first request (no TOFU) and
// keeps SSE to the foreground.
import {
  DEFAULT_SERVER_PORT, READ_METHODS, SseParser,
  type PairResponse, type PeerEvent, type PeerInfo, type PeerRepoSummary, type RpcErrorCode, type RpcResponse,
} from '@gitgud/peer-protocol'
import { pairingProof, randomHex } from './sha256'
import { TransportError, type PinnedTransport } from './transport'

export type Machine = {
  peerId: string
  name: string
  // Addresses in preference order (LAN, tailnet name, relay…); the first
  // that answers becomes `lastGood`.
  addresses: Array<{ host: string; port: number }>
  lastGood?: { host: string; port: number }
  fingerprint: string
  token: string
  readOnly: boolean
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

  private base(a: { host: string; port: number }) { return `https://${a.host}:${a.port}/gitgud` }

  // /info with the QR's fingerprint already pinned.
  async probe(a: { host: string; port: number }, fingerprint: string): Promise<PeerInfo> {
    const r = await this.t.request(`${this.base(a)}/info`, { method: 'GET', fingerprint, timeoutMs: PROBE_TIMEOUT })
    if (r.status !== 200) throw new RpcError(`Host answered ${r.status}`, 'network')
    const info = JSON.parse(r.body) as PeerInfo
    if (!info || typeof info.peerId !== 'string') throw new RpcError('Not a Git Gud host', 'network')
    if (info.fingerprint && info.fingerprint.replace(/:/g, '').toUpperCase() !== fingerprint.replace(/:/g, '').toUpperCase()) throw new RpcError('Certificate mismatch', 'tls')
    return info
  }

  // Try each address until one answers; returns the address + info.
  async probeAny(addresses: Array<{ host: string; port: number }>, fingerprint: string): Promise<{ address: { host: string; port: number }; info: PeerInfo }> {
    let last: unknown = null
    for (const address of addresses) {
      try { return { address, info: await this.probe(address, fingerprint) } } catch (e) { last = e; if ((e as RpcError).code === 'tls') throw e }
    }
    throw last ?? new RpcError('No address answered', 'network')
  }

  async pair(a: { host: string; port: number }, fingerprint: string, code: string): Promise<{ token: string; peer: PeerInfo; readOnly: boolean }> {
    const body = JSON.stringify({ proof: pairingProof(code, fingerprint), peerId: this.self.peerId, name: this.self.name, kind: 'companion' })
    const r = await this.t.request(`${this.base(a)}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, fingerprint, timeoutMs: PROBE_TIMEOUT })
    let res: PairResponse | null = null
    try { res = JSON.parse(r.body) as PairResponse } catch { /* below */ }
    if (!res) throw new RpcError(`Pairing failed (${r.status})`, 'network')
    if (!res.ok) throw new RpcError(res.error, 'failed')
    return { token: res.token, peer: res.peer, readOnly: res.readOnly === true }
  }

  async rpc<T = unknown>(m: Machine, repoPath: string, method: string, args: unknown[] = []): Promise<T> {
    if (!method.startsWith('__') && !READ_METHODS.has(method)) throw new RpcError(`"${method}" is not a read method — the companion app is read-only`, 'read-only')
    const a = m.lastGood ?? m.addresses[0]
    const id = String(++this.seq)
    let r
    try {
      r = await this.t.request(`${this.base(a)}/rpc`, {
        method: 'POST', fingerprint: m.fingerprint, timeoutMs: RPC_TIMEOUT,
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
  whoami(m: Machine): Promise<{ peerId: string; name: string; kind: string; readOnly: boolean }> { return this.rpc(m, '', '__whoami') }
  subscribePush(m: Machine, token: string, events: string[]): Promise<{ subscribed: boolean }> { return this.rpc(m, '', '__subscribePush', [{ token, events }]) }

  // Foreground-only event stream for one or more repos.
  events(m: Machine, repos: string[], onEvent: (ev: PeerEvent) => void, onClose: (err?: Error) => void): () => void {
    const a = m.lastGood ?? m.addresses[0]
    const parser = new SseParser()
    return this.t.stream(`${this.base(a)}/events?repos=${repos.map(encodeURIComponent).join(',')}`, {
      headers: { Authorization: `Bearer ${m.token}` }, fingerprint: m.fingerprint,
      onChunk: (text) => { for (const ev of parser.feed(text)) onEvent(ev) },
      onClose,
    })
  }
}

export function machineFromPairing(qr: { host: string; port: number; fingerprint: string; alts?: string[]; name?: string }, peer: PeerInfo, token: string, readOnly: boolean): Machine {
  const addresses = [{ host: qr.host, port: qr.port }, ...(qr.alts ?? []).map((h) => ({ host: h, port: qr.port || DEFAULT_SERVER_PORT }))]
  return { peerId: peer.peerId, name: peer.name || qr.name || qr.host, addresses, lastGood: addresses[0], fingerprint: peer.fingerprint || qr.fingerprint, token, readOnly, platform: peer.platform, version: peer.version, pairedAt: Date.now() }
}
