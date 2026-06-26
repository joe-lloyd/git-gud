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
  onSearchToggle: () => void
  onGitHubShow?: () => void
  onSettings?: () => void
  onToggleConsole?: () => void
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
  onSearchToggle,
  onGitHubShow,
  onSettings,
  onToggleConsole,
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
          title="Push to remote"
          disabled={pushing}
          onClick={withLoading(setPushing, onPush)}
        >
          <TbIcon spin={pushing}>↑</TbIcon>
          <span>Push</span>
          {ahead > 0 && <span className="tb-badge ahead">{ahead}</span>}
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
        <button className="tb-icon-btn" title="GitHub" onClick={onGitHubShow}>🐙</button>
        <button className="tb-icon-btn" title="Search commits" onClick={onSearchToggle}>🔍</button>
        <button className="tb-icon-btn" title="Toggle console" onClick={onToggleConsole}>▤</button>
        <button className="tb-icon-btn" title="Settings" onClick={onSettings}>⚙</button>
        <button className="tb-icon-btn" title="Refresh" onClick={onRefresh}>⟳</button>
      </div>
    </div>
  )
}

function TbIcon({ children, spin }: { children: React.ReactNode; spin?: boolean }) {
  return <span className={`tb-icon ${spin ? 'spin' : ''}`}>{children}</span>
}
