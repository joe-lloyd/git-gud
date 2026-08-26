// Renderer twin of main/peer-protocol's peer URI helpers (the renderer can't
// import from main). A repo that lives on another Git Gud instance has a tab
// path of the form gitgud-peer://<peerId>/<absolute path on that machine>.

export const PEER_URI_SCHEME = 'gitgud-peer://'

export function isPeerPath(path: string | null | undefined): boolean {
  return typeof path === 'string' && path.startsWith(PEER_URI_SCHEME)
}

export function parsePeerPath(path: string): { peerId: string; remotePath: string } | null {
  if (!isPeerPath(path)) return null
  const rest = path.slice(PEER_URI_SCHEME.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  const peerId = rest.slice(0, slash)
  let remotePath = rest.slice(slash + 1)
  if (!remotePath) return null
  if (!/^[A-Za-z]:\//.test(remotePath)) remotePath = '/' + remotePath
  return { peerId, remotePath }
}

// The folder name shown in tabs / sidebar — same rule as local paths.
export function peerRepoName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}

// Human-readable remote location for tooltips: "C:/Users/me/proj" / "/home/me/proj".
export function peerDisplayPath(path: string): string {
  return parsePeerPath(path)?.remotePath ?? path
}
