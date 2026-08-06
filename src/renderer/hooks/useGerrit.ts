import { useState, useCallback, useEffect, useRef } from 'react'
import type { CommitNode, GerritDetection, GerritChange, GerritAuthMode, PushForReviewOptions } from '../../preload/index'
import { canonicalGerritRestHost } from '../lib/gerritHost'
import { useToasts } from '../components/Toast/Toast'

// Gerrit mode state for the active repo. The mode flag and its settings live
// in repo-local git config (gitgud.gerrit.*) so they travel with the repo and
// survive tab close. Everything here is additive: with the flag unset or
// false, the hook only performs the one read-only detection pass per repo —
// no network, no UI.

const CONFIG = {
  enabled: 'gitgud.gerrit.enabled',
  host: 'gitgud.gerrit.host',
  project: 'gitgud.gerrit.project',
  branch: 'gitgud.gerrit.branch',
} as const

export type GerritMode = {
  // null = unset (never asked) — distinct from an explicit false (dismissed).
  enabled: boolean | null
  host: string
  project: string
  branch: string
}

// Minimum gap between automatic (window-focus) changes refreshes.
const FOCUS_REFRESH_MS = 30_000

export function useGerrit(
  repoPath: string | null,
  commits: CommitNode[],
  refresh: () => Promise<void> | void,
) {
  const [detection, setDetection] = useState<GerritDetection | null>(null)
  const [mode, setModeState] = useState<GerritMode | null>(null)
  const [changes, setChanges] = useState<GerritChange[]>([])
  const [changesError, setChangesError] = useState<string | null>(null)
  const [changesLoading, setChangesLoading] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  // How the last successful changes fetch authenticated (git cookies count).
  const [authMode, setAuthMode] = useState<GerritAuthMode>('anonymous')
  const toast = useToasts()

  const enabled = mode?.enabled === true

  // Signal 4 of detection lives here: Change-Id trailers in the loaded log.
  // Main can't see the parsed log, the renderer already has it.
  const logHasChangeIds = commits.some((c) => c.changeId)
  const likely = Boolean(detection?.likely) || logHasChangeIds
  const suggested = likely && mode !== null && mode.enabled === null

  // ── Load detection + persisted mode when the repo changes ────────────────
  useEffect(() => {
    let cancelled = false
    setDetection(null)
    setModeState(null)
    setChanges([])
    setChangesError(null)
    lastSyncSig.current = ''
    if (!repoPath) return
    ;(async () => {
      const [det, enabledRaw, host, project, branch] = await Promise.all([
        window.gerritApi.detect().catch(() => ({ likely: false, signals: [] } as GerritDetection)),
        window.gitApi.getConfig(CONFIG.enabled).catch(() => ''),
        window.gitApi.getConfig(CONFIG.host).catch(() => ''),
        window.gitApi.getConfig(CONFIG.project).catch(() => ''),
        window.gitApi.getConfig(CONFIG.branch).catch(() => ''),
      ])
      if (cancelled) return
      setDetection(det)
      setModeState({
        enabled: enabledRaw === 'true' ? true : enabledRaw === 'false' ? false : null,
        // Canonicalize even config-loaded hosts: pre-existing configs may
        // still hold a googlesource clone host, where REST would 404.
        host: canonicalGerritRestHost(host || det.host || ''),
        project: project || det.project || '',
        branch: branch || det.defaultBranch || 'main',
      })
    })()
    return () => { cancelled = true }
  }, [repoPath])

  // ── Auth status for the configured host ──────────────────────────────────
  useEffect(() => {
    if (!enabled || !mode?.host) { setAuthenticated(false); return }
    let cancelled = false
    window.gerritApi.authStatus(mode.host)
      .then((v) => { if (!cancelled) setAuthenticated(v) })
      .catch(() => { if (!cancelled) setAuthenticated(false) })
    return () => { cancelled = true }
  }, [enabled, mode?.host])

  // ── Open-changes fetch — deliberately NOT part of the core refresh path ──
  const fetchSeq = useRef(0)
  const lastFetchTs = useRef(0)
  // Signature of the last synced patchset set (number:ref pairs) so we only
  // run the git fetch when something actually changed on the server.
  const lastSyncSig = useRef('')
  const lastErrorToast = useRef<string | null>(null)
  const refreshChanges = useCallback(async () => {
    if (!mode || mode.enabled !== true || !mode.host || !mode.project) return
    const seq = ++fetchSeq.current
    lastFetchTs.current = Date.now()
    setChangesLoading(true)
    try {
      const r = await window.gerritApi.listChanges(mode.host, mode.project)
      if (seq !== fetchSeq.current) return // superseded by a newer fetch
      if (r.success) {
        setChanges(r.changes); setChangesError(null); setAuthMode(r.auth)
        // Mirror the open patchsets into refs/gitgud/changes/* so they show
        // up as graph nodes. The resulting ref writes trip the FS watcher,
        // which refreshes the log — no explicit refresh needed here.
        const entries = r.changes
          .filter((c) => c.currentRef)
          .map((c) => ({ number: c.number, currentRef: c.currentRef }))
        const sig = entries.map((e) => `${e.number}:${e.currentRef}`).sort().join(',')
        if (sig !== lastSyncSig.current) {
          lastSyncSig.current = sig
          window.gerritApi.syncChangeRefs(detection?.remote ?? 'origin', entries).catch(() => {})
        }
      }
      else {
        setChangesError(r.error)
        // No changes panel exists — surface fetch failures as a one-time
        // toast per distinct error so the missing graph nodes are explainable
        // without nagging on every focus refresh.
        if (r.error !== lastErrorToast.current) {
          lastErrorToast.current = r.error
          const authHint = /\b401\b|\b403\b|PERMISSION_DENIED|Unauthorized/i.test(r.error)
            ? ' This host requires sign-in — git\'s cookie auth is reused automatically; or add HTTP credentials in Settings.'
            : ''
          toast.warning('Gerrit changes unavailable', `${r.error}${authHint}`)
        }
      }
    } finally {
      if (seq === fetchSeq.current) setChangesLoading(false)
    }
  }, [mode, detection?.remote, toast])
  const refreshChangesRef = useRef(refreshChanges)
  useEffect(() => { refreshChangesRef.current = refreshChanges }, [refreshChanges])

  // On enable (and whenever host/project change while enabled).
  useEffect(() => {
    if (enabled && mode?.host && mode?.project) refreshChangesRef.current()
  }, [enabled, mode?.host, mode?.project])

  // On window focus, throttled — REST failures stay inside the panel.
  useEffect(() => {
    if (!enabled) return
    const onFocus = () => {
      if (Date.now() - lastFetchTs.current >= FOCUS_REFRESH_MS) refreshChangesRef.current()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [enabled])

  // ── Mode writes ───────────────────────────────────────────────────────────
  const writeMode = useCallback(async (rawNext: GerritMode) => {
    const next = { ...rawNext, host: canonicalGerritRestHost(rawNext.host) }
    setModeState(next)
    // Sequential on purpose: parallel `git config` writes race on
    // .git/config.lock ("could not lock config file: File exists").
    try {
      await window.gitApi.setConfig(CONFIG.enabled, next.enabled === true ? 'true' : 'false')
      if (next.host) await window.gitApi.setConfig(CONFIG.host, next.host)
      if (next.project) await window.gitApi.setConfig(CONFIG.project, next.project)
      if (next.branch) await window.gitApi.setConfig(CONFIG.branch, next.branch)
    } catch { /* config write failure — state still applies this session */ }
  }, [])

  const enable = useCallback(async (overrides?: Partial<Pick<GerritMode, 'host' | 'project' | 'branch'>>) => {
    if (!mode) return
    await writeMode({ ...mode, ...overrides, enabled: true })
    toast.success('Gerrit mode enabled', 'Push for review is now the primary push action.')
  }, [mode, writeMode, toast])

  // Dismissal persists as an explicit false so the banner never re-nags.
  const dismiss = useCallback(async () => {
    if (!mode) return
    await writeMode({ ...mode, enabled: false })
  }, [mode, writeMode])

  const disable = useCallback(async () => {
    if (!mode) return
    await writeMode({ ...mode, enabled: false })
    // Drop the mirrored change refs so the graph returns to baseline.
    lastSyncSig.current = ''
    await window.gerritApi.clearChangeRefs().catch(() => {})
    await refresh()
  }, [mode, writeMode, refresh])

  const updateSettings = useCallback(async (patch: Partial<Pick<GerritMode, 'host' | 'project' | 'branch'>>) => {
    if (!mode) return
    await writeMode({ ...mode, ...patch })
  }, [mode, writeMode])

  // ── Push for review ───────────────────────────────────────────────────────
  const pushForReview = useCallback(async (opts: PushForReviewOptions): Promise<boolean> => {
    const r = await window.gerritApi.pushForReview(opts)
    if (r.success) {
      toast.success('Pushed for review', `HEAD → refs/for/${opts.targetBranch}${opts.wip ? ' (WIP)' : ''}`)
      await refresh()
      refreshChangesRef.current()
      return true
    }
    if (r.kind === 'missing-change-id') {
      toast.error(
        'Missing Change-Id',
        'Commits need a Change-Id trailer for Gerrit. Install Gerrit\'s commit-msg hook, then amend the commit to add one.',
      )
    } else if (r.kind === 'no-new-changes') {
      toast.warning('No new changes', 'HEAD is already the latest patchset of its change.')
    } else {
      toast.error('Push for review failed', r.error)
    }
    return false
  }, [toast, refresh])

  const setAuth = useCallback(async (username: string, password: string): Promise<boolean> => {
    if (!mode?.host) return false
    const r = await window.gerritApi.setAuth(mode.host, username, password)
    if (r.success) { setAuthenticated(true); refreshChangesRef.current(); return true }
    toast.error('Could not save credentials', 'error' in r ? r.error : undefined)
    return false
  }, [mode?.host, toast])

  const clearAuth = useCallback(async () => {
    if (!mode?.host) return
    await window.gerritApi.clearAuth(mode.host)
    setAuthenticated(false)
    refreshChangesRef.current()
  }, [mode?.host])

  return {
    detection,
    mode,
    enabled,
    suggested,
    changes,
    changesError,
    changesLoading,
    authenticated,
    authMode,
    actions: {
      enable,
      dismiss,
      disable,
      updateSettings,
      pushForReview,
      refreshChanges,
      setAuth,
      clearAuth,
    },
  }
}
