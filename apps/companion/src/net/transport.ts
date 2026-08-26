// Transport abstraction: every request to a Git Gud host goes through a
// certificate-pinned channel. On device that is the `pinned-fetch` native
// module (URLSession / OkHttp with a SHA-256 pin); in Node tests it is
// https with `ca` + checkServerIdentity; on Expo web/dev it is plain fetch
// with a loud warning (no pinning possible in a browser).
export interface HttpResponse { status: number; body: string }

export interface PinnedTransport {
  // `fingerprint` is the colon-separated SHA-256 of the server's DER cert;
  // the transport MUST fail the request if the presented cert differs.
  request(url: string, opts: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; fingerprint: string; timeoutMs?: number }): Promise<HttpResponse>
  // Server-Sent Events stream; resolves the close function.
  stream(url: string, opts: { headers?: Record<string, string>; fingerprint: string; onChunk: (text: string) => void; onClose: (err?: Error) => void }): () => void
}

export class TransportError extends Error {
  constructor(message: string, public code: 'tls' | 'network' | 'timeout') { super(message); this.name = 'TransportError' }
}

export function normalizeFingerprint(fp: string): string {
  return fp.replace(/:/g, '').toUpperCase()
}
