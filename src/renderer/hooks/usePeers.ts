import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PeerState, PeerRepoSummary, PeerInfo } from '../../preload/index'
import { parsePeerPath } from '../lib/peerPath'

// Peer connections state for the renderer. Main owns everything (server,
// discovery, connections, tokens) and pushes a snapshot on every change; this
// hook mirrors it and exposes the actions the Peers modal / Settings need.

export interface PeerActions {
  setServer: (patch: { enabled?: boolean; port?: number; name?: string; readOnly?: boolean }) => Promise<void>
  regenerateCode: () => Promise<void>
  revokeDevice: (peerId: string) => Promise<void>
  setDeviceReadOnly: (peerId: string, readOnly: boolean) => Promise<void>
  probe: (host: string, port: number) => Promise<{ success: boolean; info?: PeerInfo; error?: string }>
  pair: (host: string, port: number, code: string) => Promise<{ success: boolean; peer?: { peerId: string; name: string }; error?: string }>
  connect: (peerId: string) => Promise<void>
  disconnect: (peerId: string) => Promise<void>
  /** Resolves with the tab paths that belonged to the peer (close them). */
  forget: (peerId: string) => Promise<string[]>
  listRepos: (peerId: string) => Promise<{ success: boolean; repos?: PeerRepoSummary[]; error?: string }>
}

export interface UsePeers {
  state: PeerState | null
  actions: PeerActions
  /** Display name of the machine a gitgud-peer:// path lives on, else null. */
  peerNameForPath: (path: string) => string | null
  peerForPath: (path: string) => PeerState['peers'][number] | null
}

export function usePeers(): UsePeers {
  const [state, setState] = useState<PeerState | null>(null)

  useEffect(() => {
    const api = window.peerApi
    if (!api) return
    api.getState().then((s) => { if (s) setState(s) }).catch(() => {})
    return api.onState(setState)
  }, [])

  const actions = useMemo<PeerActions>(() => ({
    setServer: async (patch) => { const s = await window.peerApi.setServer(patch); if (s) setState(s) },
    regenerateCode: async () => { await window.peerApi.regenerateCode() },
    revokeDevice: async (peerId) => { await window.peerApi.revokeDevice(peerId) },
    setDeviceReadOnly: async (peerId, readOnly) => { await window.peerApi.setDeviceReadOnly(peerId, readOnly) },
    probe: (host, port) => window.peerApi.probe(host, port),
    pair: (host, port, code) => window.peerApi.pair(host, port, code),
    connect: async (peerId) => { await window.peerApi.connect(peerId) },
    disconnect: async (peerId) => { await window.peerApi.disconnect(peerId) },
    forget: (peerId) => window.peerApi.forget(peerId),
    listRepos: (peerId) => window.peerApi.listRepos(peerId),
  }), [])

  const peerForPath = useCallback((path: string) => {
    const parsed = parsePeerPath(path)
    if (!parsed || !state) return null
    return state.peers.find((p) => p.peerId === parsed.peerId) ?? null
  }, [state])

  const peerNameForPath = useCallback((path: string) => {
    const parsed = parsePeerPath(path)
    if (!parsed) return null
    return peerForPath(path)?.name ?? parsed.peerId.slice(0, 8)
  }, [peerForPath])

  return { state, actions, peerNameForPath, peerForPath }
}
