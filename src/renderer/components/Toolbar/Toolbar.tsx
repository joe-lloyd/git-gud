import React, { useState } from 'react'
import './Toolbar.css'

interface ToolbarProps {
  repoPath: string | null
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
  onNewBranch: () => void
  /** Opens the push options menu (force push etc.) — caret click or right-click on Push */
  onPushMenu?: (e: React.MouseEvent) => void
  onSearchToggle: () => void
  onGitHubShow?: () => void
  onSettings?: () => void
  onToggleConsole?: () => void
  onCheckUpdates?: () => void
}

export const Toolbar: React.FC<ToolbarProps> = ({
  repoPath,
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
  onNewBranch,
  onPushMenu,
  onSearchToggle,
  onGitHubShow,
  onSettings,
  onToggleConsole,
  onCheckUpdates,
}) => {
  const [fetching, setFetching] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [popping, setPopping] = useState(false)

  const withLoading = (setter: (b: boolean) => void, fn: () => Promise<void>) => async () => {
    setter(true)
    try { await fn() } finally { setter(false) }
  }

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
          <TbIcon spin={fetching}>↓↑</TbIcon>
          <span>Fetch</span>
        </button>

        <button
          className="tb-btn"
          title="Pull from remote"
          disabled={pulling}
          onClick={withLoading(setPulling, onPull)}
        >
          <TbIcon spin={pulling}>↓</TbIcon>
          <span>Pull</span>
          {behind > 0 && <span className="tb-badge behind">{behind}</span>}
        </button>

        <button
          className="tb-btn"
          title="Push to remote (right-click for options)"
          disabled={pushing}
          onClick={withLoading(setPushing, onPush)}
          onContextMenu={onPushMenu}
        >
          <TbIcon spin={pushing}>↑</TbIcon>
          <span>Push</span>
          {ahead > 0 && <span className="tb-badge ahead">{ahead}</span>}
        </button>
        <button
          className="tb-btn tb-caret"
          title="Push options…"
          disabled={pushing}
          onClick={onPushMenu}
        >
          ▾
        </button>

        <div className="tb-sep" />

        <button className="tb-btn" title="Stash all changes (incl. untracked)" onClick={onStash}>
          <span>≡</span>
          <span>Stash</span>
        </button>

        <button
          className="tb-btn"
          title={stashCount === 0 ? 'No stashes to pop' : 'Pop the most recent stash'}
          disabled={popping || stashCount === 0}
          onClick={withLoading(setPopping, onPop)}
        >
          <TbIcon spin={popping}>↥</TbIcon>
          <span>Pop</span>
          {stashCount > 0 && <span className="tb-badge">{stashCount}</span>}
        </button>

        <div className="tb-sep" />

        <button className="tb-btn" title="New branch" onClick={onNewBranch}>
          <span>⎇</span>
          <span>Branch</span>
        </button>
      </div>

      <div className="tb-center">
        <div className="tb-branch">
          <span className="tb-branch-icon">⎇</span>
          <span className="tb-branch-name">{currentBranch}</span>
        </div>
      </div>

      <div className="tb-right">
        <button className="tb-icon-btn" title="GitHub" onClick={onGitHubShow}><GitHubIcon /></button>
        <button className="tb-icon-btn" title="Search commits" onClick={onSearchToggle}><SearchIcon /></button>
        <button className="tb-icon-btn" title="Toggle console" onClick={onToggleConsole}><ConsoleIcon /></button>
        <button className="tb-icon-btn" title="Check for updates" onClick={onCheckUpdates}><UpdateIcon /></button>
        <button className="tb-icon-btn" title="Settings" onClick={onSettings}><GearIcon /></button>
        <button className="tb-icon-btn" title="Refresh — re-read the repository state from disk" onClick={onRefresh}><RefreshIcon /></button>
      </div>
    </div>
  )
}

function TbIcon({ children, spin }: { children: React.ReactNode; spin?: boolean }) {
  return <span className={`tb-icon ${spin ? 'spin' : ''}`}>{children}</span>
}

// ── Inline SVG icons (no icon dependency) ─────────────────────────────────────

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

function ConsoleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

// Arrow into tray — check for app updates.
function UpdateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v10" />
      <path d="M8 9l4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  )
}

// Two circular arrows — manual refresh (re-read repo state from disk).
function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}
