import React, { useState } from 'react'
import type { BranchData, StashInfo } from '../../../preload/index'
import './Sidebar.css'

interface SidebarProps {
  repoPath: string | null
  branches: BranchData
  stashes: StashInfo[]
  currentBranch: string
  onCheckout: (branch: string) => void
  onOpenRepo: () => void
  onGoHome: () => void
}

type SidebarSection = 'branches' | 'remotes' | 'stashes'

export const Sidebar: React.FC<SidebarProps> = ({
  repoPath,
  branches,
  stashes,
  currentBranch,
  onCheckout,
  onOpenRepo,
  onGoHome,
}) => {
  const [openSections, setOpenSections] = useState<Set<SidebarSection>>(
    new Set(['branches', 'remotes', 'stashes'])
  )

  const toggle = (s: SidebarSection) =>
    setOpenSections((prev) => {
      const next = new Set(prev)
      next.has(s) ? next.delete(s) : next.add(s)
      return next
    })

  const repoName = repoPath ? repoPath.split('/').pop() : null

  return (
    <aside className="sidebar">
      {/* Repo name / open button */}
      <div className="sb-repo">
        {repoName ? (
          <>
            <button className="sb-repo-name" onClick={onOpenRepo} title={repoPath!}>
              <span className="sb-repo-icon">⎇</span>
              <span className="truncate">{repoName}</span>
            </button>
            <button className="sb-home-btn" onClick={onGoHome} title="Close repository">
              ← Home
            </button>
          </>
        ) : (
          <button className="btn btn-primary sb-open-btn" onClick={onOpenRepo}>
            Open Repository
          </button>
        )}
      </div>
      <div className="divider" />

      <nav className="sb-nav">
        {/* Local Branches */}
        <SidebarSection
          label="LOCAL BRANCHES"
          open={openSections.has('branches')}
          onToggle={() => toggle('branches')}
          count={branches.local.length}
        >
          {branches.local.map((b) => (
            <SidebarItem
              key={b.name}
              label={b.name}
              icon={b.current ? '●' : '○'}
              active={b.current}
              onClick={() => !b.current && onCheckout(b.name)}
            />
          ))}
        </SidebarSection>

        {/* Remote Branches */}
        <SidebarSection
          label="REMOTES"
          open={openSections.has('remotes')}
          onToggle={() => toggle('remotes')}
          count={branches.remote.length}
        >
          {branches.remote.map((b) => (
            <SidebarItem
              key={b.name}
              label={b.name}
              icon="⛅"
              active={false}
              onClick={() => {}}
            />
          ))}
        </SidebarSection>

        {/* Stashes */}
        <SidebarSection
          label="STASHES"
          open={openSections.has('stashes')}
          onToggle={() => toggle('stashes')}
          count={stashes.length}
        >
          {stashes.map((s) => (
            <SidebarItem
              key={s.index}
              label={s.message}
              icon="≡"
              active={false}
              onClick={() => {}}
            />
          ))}
          {stashes.length === 0 && (
            <div className="sb-empty">No stashes</div>
          )}
        </SidebarSection>
      </nav>
    </aside>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SidebarSection({
  label,
  open,
  onToggle,
  count,
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  count: number
  children: React.ReactNode
}) {
  return (
    <div className="sb-section">
      <button className="sb-section-header" onClick={onToggle}>
        <span className={`sb-chevron ${open ? 'open' : ''}`}>›</span>
        <span className="sb-section-label">{label}</span>
        <span className="sb-count">{count}</span>
      </button>
      {open && <div className="sb-section-body">{children}</div>}
    </div>
  )
}

function SidebarItem({
  label,
  icon,
  active,
  onClick,
}: {
  label: string
  icon: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`sb-item ${active ? 'active' : ''}`}
      onClick={onClick}
      title={label}
    >
      <span className="sb-item-icon">{icon}</span>
      <span className="sb-item-label truncate">{label}</span>
    </button>
  )
}
