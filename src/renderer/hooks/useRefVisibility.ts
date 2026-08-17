import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_REF_VISIBILITY,
  RefKind,
  RefVisibility,
  normalizeRefVisibility,
} from '../lib/refFilter'

// Which ref pills the graph shows. Persisted in localStorage (app-wide, not
// per-repo) so the tree looks the same on every launch.
const KEY = 'ui.refVisibility'

export interface RefVisibilityState {
  visibility: RefVisibility
  /** Master switch — hides/reveals the whole refs column. */
  toggleEnabled: () => void
  /** Flip one kind (local / remote / tags / gerrit). */
  toggleKind: (kind: RefKind) => void
  /** All kinds on (and the master switch on). */
  showAll: () => void
}

export function useRefVisibility(): RefVisibilityState {
  const [visibility, setVisibility] = useState<RefVisibility>(() => {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? normalizeRefVisibility(JSON.parse(raw)) : { ...DEFAULT_REF_VISIBILITY }
    } catch {
      return { ...DEFAULT_REF_VISIBILITY }
    }
  })

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(visibility)) } catch { /* quota — ignore */ }
  }, [visibility])

  const toggleEnabled = useCallback(
    () => setVisibility((v) => ({ ...v, enabled: !v.enabled })),
    [],
  )

  // Turning a kind back on while the master switch is off would look broken —
  // re-arm the master switch with it.
  const toggleKind = useCallback(
    (kind: RefKind) =>
      setVisibility((v) => {
        const next = { ...v, [kind]: !v[kind] }
        if (next[kind]) next.enabled = true
        return next
      }),
    [],
  )

  const showAll = useCallback(() => setVisibility({ ...DEFAULT_REF_VISIBILITY }), [])

  return { visibility, toggleEnabled, toggleKind, showAll }
}
