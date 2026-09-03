// Small helpers around ConflictState so every surface (top bar, right panel,
// editor auto-close) agrees on what "the repo is paused" means and how each
// operation is named.
import type { ConflictState, ConflictOp } from '../../preload/index'

/** True while any merge / rebase / cherry-pick / revert / stash re-apply is paused. */
export function conflictActive(c: ConflictState | null | undefined): c is ConflictState & { op: ConflictOp } {
  return !!c && c.op !== undefined
}

/** Human label for an operation, e.g. "cherry-pick" → "Cherry-pick". */
export function opLabel(op: ConflictOp, opts: { upper?: boolean } = {}): string {
  const base = op === 'stash' ? 'stash re-apply' : op
  if (opts.upper) return base.toUpperCase()
  return base[0].toUpperCase() + base.slice(1)
}

/** Which verbs the panel can offer for an operation. */
export function opControls(op: ConflictOp): { canContinue: boolean; canSkip: boolean; canAbort: boolean } {
  return {
    canContinue: op !== 'stash',
    canSkip: op === 'rebase' || op === 'cherry-pick' || op === 'revert',
    canAbort: true,
  }
}
