import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_REF_VISIBILITY,
  RefKind,
  RefVisibility,
  normalizeRefVisibility,
} from '../lib/refFilter'

// What the graph shows. Persisted in localStorage (app-wide, not per-repo) so
// the tree looks the same on every launch.
const KEY = 'ui.refVisibility'

export interface RefVisibilityState {
  visibility: RefVisibility
  /** Walk tool-private namespaces (refs/t3/*, refs/notes, …) in the log. */
  toggleOtherRefs: () => void
  /** Flip one pill kind (local / remote / tags / gerrit). */
  toggleKind: (kind: RefKind) => void
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

  const toggleOtherRefs = useCallback(
    () => setVisibility((v) => ({ ...v, otherRefs: !v.otherRefs })),
    [],
  )

  const toggleKind = useCallback(
    (kind: RefKind) => setVisibility((v) => ({ ...v, [kind]: !v[kind] })),
    [],
  )

  return { visibility, toggleOtherRefs, toggleKind }
}
