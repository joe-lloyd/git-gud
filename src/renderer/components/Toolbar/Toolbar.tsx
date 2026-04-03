import React, { useState } from 'react'
import './Toolbar.css'

interface ToolbarProps {
  repoPath: string | null
  currentBranch: string
  ahead: number
  behind: number
  onFetch: () => Promise<void>
  onPull: () => Promise<void>
  onPush: () => Promise<void>
  onRefresh: () => void
  onNewBranch: () => void
  onSearchToggle: () => void
}

export const Toolbar: React.FC<ToolbarProps> = ({
  repoPath,
  currentBranch,
  ahead,
  behind,
  onFetch,
  onPull,
  onPush,
  onRefresh,
  onNewBranch,
  onSearchToggle,
}) => {
  const [fetching, setFetching] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pushing, setPushing] = useState(false)

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
        <button className="tb-icon-btn" title="Search commits" onClick={onSearchToggle}>🔍</button>
        <button className="tb-icon-btn" title="Refresh" onClick={onRefresh}>⟳</button>
      </div>
    </div>
  )
}

function TbIcon({ children, spin }: { children: React.ReactNode; spin?: boolean }) {
  return <span className={`tb-icon ${spin ? 'spin' : ''}`}>{children}</span>
}
