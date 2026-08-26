// Picks the transport for this runtime: the pinned native module on iOS /
// Android, plain fetch on web (dev only — browsers cannot pin certificates
// and will refuse the self-signed cert anyway unless it was trusted manually).
import { Platform } from 'react-native'
import { TransportError, type PinnedTransport } from './transport'

export function createTransport(): PinnedTransport {
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    // Lazy require so the JS bundle still loads in Expo Go (module absent).
    try {
      const mod = require('../../modules/pinned-fetch') as typeof import('../../modules/pinned-fetch')
      return mod.pinnedTransport()
    } catch (e) {
      console.warn('pinned-fetch native module unavailable — falling back to unpinned fetch (Expo Go?)', e)
    }
  }
  return unpinnedFetchTransport()
}

// DEV ONLY. No pinning: the platform trust store decides, which rejects
// self-signed hosts. Kept so the UI can be developed against a plain-HTTP
// proxy; every response is tagged so screens can show a warning.
export function unpinnedFetchTransport(): PinnedTransport {
  return {
    async request(url, o) {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 30_000)
      try {
        const r = await fetch(url, { method: o.method, headers: o.headers, body: o.body, signal: ctrl.signal })
        return { status: r.status, body: await r.text() }
      } catch (e) {
        throw new TransportError(String((e as Error).message ?? e), ctrl.signal.aborted ? 'timeout' : 'network')
      } finally { clearTimeout(t) }
    },
    stream(url, o) {
      const ctrl = new AbortController()
      fetch(url, { headers: o.headers, signal: ctrl.signal }).then(async (r) => {
        const reader = r.body?.getReader()
        if (!reader) { o.onClose(new Error('no stream body')); return }
        const dec = new TextDecoder()
        for (;;) { const { done, value } = await reader.read(); if (done) break; o.onChunk(dec.decode(value, { stream: true })) }
        o.onClose()
      }).catch((e) => o.onClose(e instanceof Error ? e : new Error(String(e))))
      return () => ctrl.abort()
    },
  }
}
