// JS side of the pinned-fetch Expo module. The native side performs the HTTP
// request over TLS and REFUSES the connection unless the SHA-256 of the
// server's DER certificate equals `fingerprint` (hex, no colons). Streams
// deliver chunks as events keyed by a stream id.
import { NativeModule, requireNativeModule } from 'expo-modules-core'
import { TransportError, normalizeFingerprint, type PinnedTransport } from '../../src/net/transport'

type NativeResponse = { status: number; body: string }
type Events = {
  chunk: (ev: { id: string; text: string }) => void
  close: (ev: { id: string; error?: string }) => void
}
declare class PinnedFetchNative extends NativeModule<Events> {
  // relayHost: when set, TCP goes to this host (the URL's port) while TLS SNI
  // stays the URL host name — how a relay routes us to the right Git Gud host.
  request(url: string, method: string, headers: Record<string, string>, body: string | null, fingerprintHex: string, timeoutMs: number, relayHost: string | null): Promise<NativeResponse>
  openStream(id: string, url: string, headers: Record<string, string>, fingerprintHex: string, relayHost: string | null): Promise<void>
  closeStream(id: string): void
}

const native = requireNativeModule<PinnedFetchNative>('PinnedFetch')
let streamSeq = 0

function mapError(e: unknown): TransportError {
  const msg = String((e as Error)?.message ?? e)
  if (/pin|certificate|trust|ssl|tls/i.test(msg)) return new TransportError(msg, 'tls')
  if (/timed? ?out/i.test(msg)) return new TransportError(msg, 'timeout')
  return new TransportError(msg, 'network')
}

export function pinnedTransport(): PinnedTransport {
  return {
    async request(url, o) {
      try {
        return await native.request(url, o.method, o.headers ?? {}, o.body ?? null, normalizeFingerprint(o.fingerprint), o.timeoutMs ?? 30_000, o.viaRelay?.host ?? null)
      } catch (e) { throw mapError(e) }
    },
    stream(url, o) {
      const id = `s${++streamSeq}`
      const subs = [
        native.addListener('chunk', (ev) => { if (ev.id === id) o.onChunk(ev.text) }),
        native.addListener('close', (ev) => { if (ev.id === id) { cleanup(); o.onClose(ev.error ? mapError(new Error(ev.error)) : undefined) } }),
      ]
      const cleanup = () => { for (const s of subs) s.remove() }
      native.openStream(id, url, o.headers ?? {}, normalizeFingerprint(o.fingerprint), o.viaRelay?.host ?? null).catch((e: unknown) => { cleanup(); o.onClose(mapError(e)) })
      return () => { native.closeStream(id); cleanup() }
    },
  }
}
