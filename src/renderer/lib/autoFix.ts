// Auto-fix: when git refuses an action because of the working tree (dirty
// files, untracked files in the way) the app clears the blocker itself —
// stash → retry → re-apply — instead of showing a "you can't do that" popup.
// The main-process runner (GitService.autoFix) does the work; this module owns
// the user-facing side: the on/off preference and one consistent way to report
// what happened so the user always sees exactly which steps ran.
import type { AutoFixResult } from '../../preload/index'
import type { ToastApi } from '../components/Toast/Toast'

const KEY = 'gitgud.autoFix'

/** Preference: default ON. Persisted in localStorage (per machine, all repos). */
export function autoFixEnabled(): boolean {
  try { return window.localStorage.getItem(KEY) !== 'false' } catch { return true }
}
export function setAutoFixEnabled(on: boolean): void {
  try { window.localStorage.setItem(KEY, on ? 'true' : 'false') } catch { /* private mode etc. */ }
}

export interface ReportOpts {
  /** Past-tense success title, e.g. "Pulled", "Checked out main". */
  successTitle: string
  /** Extra success detail when nothing was auto-fixed (optional). */
  successDetail?: string
  /** Error title, e.g. "Pull failed". */
  failTitle: string
  /** Called when the user clicks "Pop stash" on a kept-stash notice. */
  onPopStash?: () => void
  /** Called when the op paused on conflicts (refresh so the panel appears). */
  onConflict?: () => void
}

/**
 * Turn an AutoFixResult into toasts. Rules:
 *  - plain success, nothing fixed → normal success toast (or silence if no title)
 *  - success with fixes → "Auto-fixed" toast listing every step
 *  - success but a stash was kept → warning with a "Pop stash" action
 *  - paused on conflicts → warning pointing at the conflict panel
 *  - anything else → error with git's message
 * Returns true when the caller should treat the op as done (success or conflict).
 */
export function reportAutoFix(toast: ToastApi, r: AutoFixResult, o: ReportOpts): boolean {
  const steps = r.steps.length ? r.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : undefined
  if (r.success) {
    if (r.stashKept && !r.conflict) {
      toast.warning(
        `${o.successTitle} · stash kept`,
        steps ?? `Your changes are in stash "${r.stashKept}".`,
        o.onPopStash ? { label: 'Pop stash now', onClick: o.onPopStash } : undefined,
      )
    } else if (r.conflict) {
      toast.warning(`${o.successTitle} · re-apply conflicted`, steps)
      o.onConflict?.()
    } else if (r.autoFixed) {
      toast.success(`${o.successTitle} · auto-fixed`, steps)
    } else if (o.successDetail !== undefined) {
      toast.success(o.successTitle, o.successDetail)
    }
    return true
  }
  if (r.conflict) {
    toast.warning(`${o.failTitle.replace(/ failed$/i, '')} paused on conflicts`, steps ?? 'Resolve the files in the right panel, then continue.')
    o.onConflict?.()
    return true
  }
  if (r.kind === 'in-progress') {
    toast.warning('Another operation is still in progress', 'Finish or abort it in the right panel first.')
    return false
  }
  toast.error(o.failTitle, [steps, r.error].filter(Boolean).join('\n'))
  return false
}
