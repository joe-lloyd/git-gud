// Peer repo URI helpers for the renderer — the same code the main process
// and the daemon use, via the shared protocol package (no drift possible).
import { PEER_URI_SCHEME, isPeerRepoPath, parsePeerRepoPath } from '@gitgud/peer-protocol'

export { PEER_URI_SCHEME }
export const isPeerPath = isPeerRepoPath
export const parsePeerPath = parsePeerRepoPath

// The folder name shown in tabs / sidebar — same rule as local paths.
export function peerRepoName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}

// Human-readable remote location for tooltips: "C:/Users/me/proj" / "/home/me/proj".
export function peerDisplayPath(path: string): string {
  return parsePeerPath(path)?.remotePath ?? path
}
