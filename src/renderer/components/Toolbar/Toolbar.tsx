import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icons/Icon'
import { RefKind, RefVisibility, refsColumnHidden } from '../../lib/refFilter'
import './Toolbar.css'

interface ToolbarProps {
  repoPath: string | null
  /** Set when a non-main worktree is active — shows the worktree chip. */
  worktreeName?: string | null
  /** Click on the worktree chip (opens the worktree manager). */
  onWorktreeChip?: () => void
  currentBranch: string
  ahead: number
  behind: number
  stashCount: number
  onFetch: () => Promise<void>
  onPull: () => Promise<void>
  onPush: () => Promise<void>
  onStash: () => void
  onPop: () => Promise<void>
  onRefresh: () => void
  /** True while a repo refresh is in flight — animates the refresh button. */
  refreshing?: boolean
  onNewBranch: () => void
  /** Opens the push options menu (force push etc.) — caret click or right-click on Push */
  onPushMenu?: (e: React.MouseEvent) => void
  /** Opens the pull options menu (ff-only / rebase) — caret click or right-click on Pull */
  onPullMenu?: (e: React.MouseEvent) => void
  /** Gerrit mode: the primary push action becomes "Push for review"; plain
      push stays reachable through the caret menu. */
  gerritMode?: boolean
  onPushForReview?: () => void
  onSearchToggle: () => void
  onGitHubShow?: () => void
  onSettings?: () => void
  onToggleConsole?: () => void
  onCheckUpdates?: () => void
  /** Ref-pill visibility in the graph — click toggles all, caret opens per-kind. */
  refVisibility?: RefVisibility
  onToggleRefs?: () => void
  onToggleRefKind?: (kind: RefKind) => void
}

export const Toolbar: React.FC<ToolbarProps> = ({
  repoPath,
  worktreeName = null,
  onWorktreeChip,
  currentBranch,
  ahead,
  behind,
  stashCount,
  onFetch,
  onPull,
  onPush,
  onStash,
  onPop,
  onRefresh,
  refreshing = false,
  onNewBranch,
  onPushMenu,
  onPullMenu,
  gerritMode = false,
  onPushForReview,
  onSearchToggle,
  onGitHubShow,
  onSettings,
  onToggleConsole,
  onCheckUpdates,
  refVisibility,
  onToggleRefs,
  onToggleRefKind,
}) => {
  const [fetching, setFetching] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [popping, setPopping] = useState(false)

  const withLoading = (setter: (b: boolean) => void, fn: () => Promise<void>) => async () => {
    setter(true)
    try { await fn() } finally { setter(false) }
  }

  // Silent refreshes usually finish in well under a frame's worth of git
  // reads — stretch the indicator to a minimum beat so the animation reads as
  // "checked" instead of flickering.
  const MIN_SPIN_MS = 700
  const [spinning, setSpinning] = useState(false)
  const spinUntil = useRef(0)
  useEffect(() => {
    if (refreshing) {
      spinUntil.current = Date.now() + MIN_SPIN_MS
      setSpinning(true)
      return
    }
    const remain = spinUntil.current - Date.now()
    if (remain <= 0) { setSpinning(false); return }
    const t = setTimeout(() => setSpinning(false), remain)
    return () => clearTimeout(t)
  }, [refreshing])

  if (!repoPath) return null

  return (
    <div className="toolbar">
      <div className="tb-left">
        <button
          className="tb-btn"
          title="Fetch all remotes"
          disabled={fetching}
          onClick={withLoading(setFetching, onFetch)}
        >
          <TbIcon spin={fetching}><Icon name="fetch" size={14} /></TbIcon>
          <span>Fetch</span>
        </button>

        <button
          className="tb-btn"
          title="Pull from remote (right-click for options)"
          disabled={pulling}
          onClick={withLoading(setPulling, onPull)}
          onContextMenu={onPullMenu}
        >
          <TbIcon spin={pulling}><Icon name="arrow-down" size={14} /></TbIcon>
          <span>Pull</span>
          {behind > 0 && <span className="tb-badge behind">{behind}</span>}
        </button>
        {onPullMenu && (
          <button
            className="tb-btn tb-caret"
            title="Pull options…"
            disabled={pulling}
            onClick={onPullMenu}
          >
            <Icon name="chevron-down" size={12} />
          </button>
        )}

        {gerritMode && onPushForReview ? (
          <button
            className="tb-btn"
            title="Push HEAD for review — refs/for/… (right-click for plain push)"
            disabled={pushing}
            onClick={onPushForReview}
            onContextMenu={onPushMenu}
          >
            <TbIcon spin={pushing}><Icon name="arrow-up" size={14} /></TbIcon>
            <span>Push for review</span>
            {ahead > 0 && <span className="tb-badge ahead">{ahead}</span>}
          </button>
        ) : (
          <button
            className="tb-btn"
            title="Push to remote (right-click for options)"
            disabled={pushing}
            onClick={withLoading(setPushing, onPush)}
            onContextMenu={onPushMenu}
          >
            <TbIcon spin={pushing}><Icon name="arrow-up" size={14} /></TbIcon>
            <span>Push</span>
            {ahead > 0 && <span className="tb-badge ahead">{ahead}</span>}
          </button>
        )}
        <button
          className="tb-btn tb-caret"
          title="Push options…"
          disabled={pushing}
          onClick={onPushMenu}
        >
          <Icon name="chevron-down" size={12} />
        </button>

        <div className="tb-sep" />

        <button className="tb-btn" title="Stash all changes (incl. untracked)" onClick={onStash}>
          <TbIcon><Icon name="stash" size={14} /></TbIcon>
          <span>Stash</span>
        </button>

        <button
          className="tb-btn"
          title={stashCount === 0 ? 'No stashes to pop' : 'Pop the most recent stash'}
          disabled={popping || stashCount === 0}
          onClick={withLoading(setPopping, onPop)}
        >
          <TbIcon spin={popping}><Icon name="stash-pop" size={14} /></TbIcon>
          <span>Pop</span>
          {stashCount > 0 && <span className="tb-badge">{stashCount}</span>}
        </button>

        <div className="tb-sep" />

        <button className="tb-btn" title="New branch" onClick={onNewBranch}>
          <TbIcon><Icon name="branch" size={14} /></TbIcon>
          <span>Branch</span>
        </button>
      </div>

      <div className="tb-center">
        <div className="tb-branch">
          <span className="tb-branch-icon"><Icon name="branch" size={13} /></span>
          <span className="tb-branch-name">{currentBranch}</span>
        </div>
        {worktreeName && (
          <button
            className="tb-worktree-chip"
            title={`Linked worktree "${worktreeName}" is active — click to manage worktrees`}
            onClick={onWorktreeChip}
          >
            <Icon name="worktree" size={12} />
            <span>{worktreeName}</span>
          </button>
        )}
      </div>

      <div className="tb-right">
        {refVisibility && onToggleRefs && onToggleRefKind && (
          <RefsToggle
            visibility={refVisibility}
            onToggleAll={onToggleRefs}
            onToggleKind={onToggleRefKind}
          />
        )}
        <button className="tb-icon-btn" title="GitHub" onClick={onGitHubShow}><Icon name="github" /></button>
        <button className="tb-icon-btn" title="Search commits" onClick={onSearchToggle}><Icon name="search" /></button>
        <button className="tb-icon-btn" title="Toggle console" onClick={onToggleConsole}><Icon name="terminal" /></button>
        <button className="tb-icon-btn" title="Check for updates" onClick={onCheckUpdates}><Icon name="update" /></button>
        <button className="tb-icon-btn" title="Settings" onClick={onSettings}><Icon name="settings" /></button>
        <button
          className={`tb-icon-btn tb-refresh ${spinning ? 'refreshing' : ''}`}
          title="Refresh — re-read the repository state from disk"
          onClick={onRefresh}
        >
          <span className="tb-refresh-icon"><Icon name="refresh" /></span>
          {/* Boss-bar style sweep — absolutely positioned, zero layout shift */}
          <span className="tb-refresh-bar" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

function TbIcon({ children, spin }: { children: React.ReactNode; spin?: boolean }) {
  return <span className={`tb-icon ${spin ? 'spin' : ''}`}>{children}</span>
}

// Ref pills in the graph: click hides/shows them all, the caret opens per-kind
// checkboxes (local / remote / tags / Gerrit changes).
const REF_KIND_LABELS: { kind: RefKind; label: string }[] = [
  { kind: 'local', label: 'Local branches' },
  { kind: 'remote', label: 'Remote branches' },
  { kind: 'tags', label: 'Tags' },
  { kind: 'gerrit', label: 'Gerrit changes' },
]

function RefsToggle({ visibility, onToggleAll, onToggleKind }: {
  visibility: RefVisibility
  onToggleAll: () => void
  onToggleKind: (kind: RefKind) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const hidden = refsColumnHidden(visibility)

  return (
    <div className="tb-refs" ref={wrapRef}>
      <button
        className={`tb-icon-btn ${hidden ? 'tb-refs-off' : ''}`}
        title={`${hidden ? 'Show' : 'Hide'} branch/tag labels in the graph (right-click to pick kinds)`}
        onClick={onToggleAll}
        onContextMenu={(e) => { e.preventDefault(); setOpen(true) }}
      >
        <Icon name="tag" />
      </button>
      <button
        className="tb-refs-caret"
        title="Choose which refs to show"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="chevron-down" size={9} />
      </button>

      {open && (
        <div className="tb-refs-menu">
          <label className="tb-refs-item">
            <input type="checkbox" checked={visibility.enabled} onChange={onToggleAll} />
            <span>Show refs</span>
          </label>
          <div className="tb-refs-sep" />
          {REF_KIND_LABELS.map(({ kind, label }) => (
            <label key={kind} className={`tb-refs-item ${visibility.enabled ? '' : 'dim'}`}>
              <input type="checkbox" checked={visibility[kind]} onChange={() => onToggleKind(kind)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
