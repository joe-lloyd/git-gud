// googlesource serves git/gitiles on `X.googlesource.com` but the Gerrit UI
// and REST API on `X-review.googlesource.com` — /changes/ 404s on the clone
// host. Map to the -review host; anything else passes through unchanged.
// Twin of canonicalGerritRestHost in src/main/gerrit-utils.ts (main-process
// modules can't be imported by the renderer) — keep the two in sync.
export function canonicalGerritRestHost(host: string): string {
  return host.replace(
    /^(https?:\/\/)([a-z0-9-]+)(\.googlesource\.com)(?=$|[:/])/i,
    (_m, proto, sub, dom) => (sub.toLowerCase().endsWith("-review") ? _m : `${proto}${sub}-review${dom}`),
  )
}
