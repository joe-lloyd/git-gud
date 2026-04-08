/**
 * useCommitActions
 *
 * Isolated, unit-testable async functions for every git operation reachable
 * from the commit-node right-click context menu.
 *
 * Each action:
 *  - is a standalone `useCallback` — no side-effects bleed between them
 *  - shows a toast on success/failure
 *  - calls `refresh()` after mutating the repo state
 *
 * Actions that need user input (branch name, tag name, hard-reset confirm)
 * delegate to `openModal` so the modal state stays in App.tsx.
 */

import { useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

export type CommitActionModal =
  | { type: 'branch-here';           sha: string }
  | { type: 'tag-here';              sha: string }
  | { type: 'confirm-reset-hard';    sha: string }
  | { type: 'interactive-rebase';    sha: string }

interface Toast {
  success: (title: string, msg: string) => void
  error:   (title: string, msg: string) => void
}

interface Methods {
  handleCheckout: (sha: string) => Promise<void>
  refresh:        () => void
}

interface UseCommitActionsOptions {
  toast:     Toast
  methods:   Methods
  /** Called when an action needs a modal before it can complete */
  openModal: (modal: CommitActionModal) => void
  /** Called just before opening the interactive-rebase modal */
  setSelectedSha: (sha: string) => void
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCommitActions({
  toast,
  methods,
  openModal,
  setSelectedSha,
}: UseCommitActionsOptions) {

  /** Checkout a commit (detached HEAD). */
  const checkoutSha = useCallback(async (sha: string) => {
    await methods.handleCheckout(sha)
  }, [methods])

  /** Opens the "create branch at SHA" input modal. */
  const requestBranchHere = useCallback((sha: string) => {
    openModal({ type: 'branch-here', sha })
  }, [openModal])

  /**
   * Creates a local branch at the given SHA and checks it out.
   * Called by the modal once the user has typed a name.
   */
  const createBranchHere = useCallback(async (name: string, sha: string) => {
    const ok = await window.gitApi.createBranch(name, sha)
    if (ok) {
      toast.success('Branch Created', `"${name}" created at ${sha.slice(0, 7)}`)
      methods.refresh()
    } else {
      toast.error('Branch Failed', `Could not create branch "${name}".`)
    }
  }, [toast, methods])

  /** Cherry-picks a single commit onto the current branch. */
  const cherryPick = useCallback(async (sha: string) => {
    const ok = await window.gitApi.cherryPick(sha)
    if (ok) {
      toast.success('Cherry-picked', `Commit ${sha.slice(0, 7)} applied.`)
      methods.refresh()
    } else {
      toast.error('Cherry-pick Failed', 'Could not cherry-pick this commit.')
    }
  }, [toast, methods])

  /** Rebases the current branch onto the given commit. */
  const rebaseTo = useCallback(async (sha: string) => {
    const result = await window.gitApi.rebaseTo(sha)
    if (result.success) {
      toast.success('Rebase Complete', `Current branch rebased onto ${sha.slice(0, 7)}.`)
      methods.refresh()
    } else {
      toast.error('Rebase Failed', result.error ?? 'Rebase could not be completed.')
    }
  }, [toast, methods])

  /** Opens the interactive-rebase modal starting from a specific commit. */
  const interactiveRebaseFrom = useCallback((sha: string) => {
    setSelectedSha(sha)
    openModal({ type: 'interactive-rebase', sha })
  }, [setSelectedSha, openModal])

  /** Merges the given commit (or its branch) INTO the current branch. */
  const mergeThisIntoCurrent = useCallback(async (sha: string) => {
    const ok = await window.gitApi.merge(sha)
    if (ok) {
      toast.success('Merge Complete', `Merged ${sha.slice(0, 7)} into current branch.`)
      methods.refresh()
    } else {
      toast.error('Merge Failed', 'Could not merge this commit.')
    }
  }, [toast, methods])

  /**
   * Merges the current branch INTO a target branch (by name).
   * Only available when the clicked commit has a local branch ref.
   */
  const mergeCurrentIntoThis = useCallback(async (targetBranch: string) => {
    const result = await window.gitApi.mergeCurrentInto(targetBranch)
    if (result.success) {
      toast.success('Merge Complete', `Current branch merged into "${targetBranch}".`)
      methods.refresh()
    } else {
      toast.error('Merge Failed', result.error ?? `Could not merge into "${targetBranch}".`)
    }
  }, [toast, methods])

  /** git reset --soft. Moves HEAD; keeps index and working tree intact. */
  const resetSoft = useCallback(async (sha: string) => {
    const result = await window.gitApi.reset(sha, 'soft')
    if (result.success) {
      toast.success('Reset (Soft)', `HEAD moved to ${sha.slice(0, 7)}. Index + working tree unchanged.`)
      methods.refresh()
    } else {
      toast.error('Reset Failed', result.error ?? 'Could not reset.')
    }
  }, [toast, methods])

  /** git reset --mixed. Moves HEAD + index; keeps working tree intact. */
  const resetMixed = useCallback(async (sha: string) => {
    const result = await window.gitApi.reset(sha, 'mixed')
    if (result.success) {
      toast.success('Reset (Mixed)', `HEAD + index moved to ${sha.slice(0, 7)}. Working tree unchanged.`)
      methods.refresh()
    } else {
      toast.error('Reset Failed', result.error ?? 'Could not reset.')
    }
  }, [toast, methods])

  /** Opens the hard-reset confirmation modal (ConfirmModal). */
  const requestResetHard = useCallback((sha: string) => {
    openModal({ type: 'confirm-reset-hard', sha })
  }, [openModal])

  /**
   * git reset --hard. Called after the user confirms in ConfirmModal.
   * Discards all uncommitted changes — irreversible.
   */
  const resetHard = useCallback(async (sha: string) => {
    const result = await window.gitApi.reset(sha, 'hard')
    if (result.success) {
      toast.success('Reset (Hard)', `HEAD, index, and working tree reset to ${sha.slice(0, 7)}.`)
      methods.refresh()
    } else {
      toast.error('Reset Failed', result.error ?? 'Could not hard reset.')
    }
  }, [toast, methods])

  /** Opens the "create tag at SHA" input modal. */
  const requestTagHere = useCallback((sha: string) => {
    openModal({ type: 'tag-here', sha })
  }, [openModal])

  /**
   * Creates a lightweight tag at the given SHA.
   * Called by the modal once the user has typed a name.
   */
  const createTag = useCallback(async (name: string, sha: string) => {
    const result = await window.gitApi.createTag(name, sha)
    if (result.success) {
      toast.success('Tag Created', `Tag "${name}" created at ${sha.slice(0, 7)}.`)
      methods.refresh()
    } else {
      toast.error('Tag Failed', result.error ?? `Could not create tag "${name}".`)
    }
  }, [toast, methods])

  return {
    checkoutSha,
    requestBranchHere,
    createBranchHere,
    cherryPick,
    rebaseTo,
    interactiveRebaseFrom,
    mergeThisIntoCurrent,
    mergeCurrentIntoThis,
    resetSoft,
    resetMixed,
    requestResetHard,
    resetHard,
    requestTagHere,
    createTag,
  }
}
