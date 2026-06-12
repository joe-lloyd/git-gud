import React, { useState } from 'react'
import type { BranchData, StashInfo, RemoteInfo, TagInfo, BranchInfo } from '../../../preload/index'
import { REF_DRAG_MIME } from '../Graph/GraphView'
import './Sidebar.css'

interface SidebarProps {
  repoPath: string | null
  branches: BranchData
  stashes: StashInfo[]
  tags: TagInfo[]
  remotes: RemoteInfo[]
  currentBranch: string
  selectedRef: string | null
  onSelectRef: (ref: string | null) => void
  onCheckout: (branch: string) => void
  onCheckoutRemote: (remoteRef: string) => void
  onApplyStash: (index: number) => void
  onCreateBranchFromTag: (tagName: string) => void
  onOpenRepo: () => void
  onGoHome: () => void
  onBranchContextMenu: (e: React.MouseEvent, branchName: string, kind: 'local' | 'remote') => void
  onStashContextMenu: (e: React.MouseEvent, index: number) => void
  onTagContextMenu: (e: React.MouseEvent, tagName: string) => void
  /** Drop a ref pill (from graph) onto a sidebar branch row */
  onRefDrop: (e: React.MouseEvent, source: string, target: string) => void
}

export const Sidebar: React.FC<SidebarProps> = ({
  repoPath,
  branches,
  stashes,
  tags,
  remotes,
  currentBranch,
  selectedRef,
  onSelectRef,
  onCheckout,
  onCheckoutRemote,
  onApplyStash,
  onCreateBranchFromTag,
  onOpenRepo,
  onGoHome,
  onBranchContextMenu,
  onStashContextMenu,
  onTagContextMenu,
  onRefDrop,
}) => {
  const repoName = repoPath ? repoPath.split('/').pop() : null

  // Group remote branches by remote (first path segment)
  const remoteGroups = groupRemoteBranches(branches.remote)

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
        <SidebarSection label="LOCAL BRANCHES" count={branches.local.length} defaultOpen>
          {branches.local.length === 0
            ? <div className="sb-empty">No local branches</div>
            : branches.local.map((b) => (
                <BranchRow
                  key={b.name}
                  name={b.name}
                  fullRef={b.name}
                  isCurrent={b.current || b.name === currentBranch}
                  isSelected={selectedRef === `local:${b.name}`}
                  onSelect={() => onSelectRef(`local:${b.name}`)}
                  onDoubleClick={() => !b.current && onCheckout(b.name)}
                  onContextMenu={(e) => onBranchContextMenu(e, b.name, 'local')}
                  onRefDrop={onRefDrop}
                />
              ))
          }
        </SidebarSection>

        {/* Remote Branches — grouped by remote */}
        <SidebarSection label="REMOTE BRANCHES" count={branches.remote.length} defaultOpen>
          {remoteGroups.length === 0 && remotes.length === 0
            ? <div className="sb-empty">No remotes configured</div>
            : remoteGroups.map(({ remote, items }) => (
                <RemoteGroup
                  key={remote}
                  remote={remote}
                  url={remotes.find(r => r.name === remote)?.url}
                  items={items}
                  selectedRef={selectedRef}
                  onSelectRef={onSelectRef}
                  onCheckoutRemote={onCheckoutRemote}
                  onContextMenu={onBranchContextMenu}
                  onRefDrop={onRefDrop}
                />
              ))
          }
          {/* Surface remotes that exist but have no fetched branches yet */}
          {remotes.filter(r => !remoteGroups.find(g => g.remote === r.name)).map((r) => (
            <div key={`empty-${r.name}`} className="sb-remote-group">
              <div className="sb-remote-header">
                <span className="sb-chevron">·</span>
                <span className="sb-section-label sb-remote-name">{r.name}</span>
                <span className="sb-empty-inline">(no branches fetched)</span>
              </div>
            </div>
          ))}
        </SidebarSection>

        {/* Stashes */}
        <SidebarSection label="STASHES" count={stashes.length} defaultOpen>
          {stashes.length === 0
            ? <div className="sb-empty">No stashes</div>
            : stashes.map((s) => (
                <SidebarItem
                  key={s.index}
                  label={s.message}
                  icon="≡"
                  selected={selectedRef === `stash:${s.index}`}
                  onClick={() => onSelectRef(`stash:${s.index}`)}
                  onDoubleClick={() => onApplyStash(s.index)}
                  onContextMenu={(e) => onStashContextMenu(e, s.index)}
                  title={`stash@{${s.index}}: ${s.message}`}
                />
              ))
          }
        </SidebarSection>

        {/* Tags */}
        <SidebarSection label="TAGS" count={tags.length} defaultOpen={false}>
          {tags.length === 0
            ? <div className="sb-empty">No tags</div>
            : tags.map((t) => (
                <SidebarItem
                  key={t.name}
                  label={t.name}
                  icon="🏷"
                  selected={selectedRef === `tag:${t.name}`}
                  onClick={() => onSelectRef(`tag:${t.name}`)}
                  onDoubleClick={() => onCreateBranchFromTag(t.name)}
                  onContextMenu={(e) => onTagContextMenu(e, t.name)}
                  title={`${t.name} → ${t.sha.slice(0, 7)}`}
                />
              ))
          }
        </SidebarSection>
      </nav>
    </aside>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SidebarSection({
  label,
  count,
  defaultOpen = true,
  children,
}: {
  label: string
  count: number
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details className="sb-section" open={defaultOpen}>
      <summary className="sb-section-header">
        <span className="sb-chevron">›</span>
        <span className="sb-section-label">{label}</span>
        <span className="sb-count">{count}</span>
      </summary>
      <div className="sb-section-body">{children}</div>
    </details>
  )
}

function RemoteGroup({
  remote,
  url,
  items,
  selectedRef,
  onSelectRef,
  onCheckoutRemote,
  onContextMenu,
  onRefDrop,
}: {
  remote: string
  url?: string
  items: BranchInfo[]
  selectedRef: string | null
  onSelectRef: (ref: string) => void
  onCheckoutRemote: (remoteRef: string) => void
  onContextMenu: (e: React.MouseEvent, name: string, kind: 'local' | 'remote') => void
  onRefDrop: (e: React.MouseEvent, source: string, target: string) => void
}) {
  return (
    <details className="sb-remote-group" open>
      <summary className="sb-remote-header" title={url}>
        <span className="sb-chevron">›</span>
        <span className="sb-remote-icon">⛅</span>
        <span className="sb-remote-name">{remote}</span>
        <span className="sb-count">{items.length}</span>
      </summary>
      <div className="sb-remote-body">
        {items.map((b) => {
          const shortName = b.name.replace(`${remote}/`, '')
          const fullRef = b.name // e.g. "origin/feature-x"
          return (
            <BranchRow
              key={b.name}
              name={shortName}
              fullRef={fullRef}
              isCurrent={false}
              isSelected={selectedRef === `remote:${fullRef}`}
              isRemote
              onSelect={() => onSelectRef(`remote:${fullRef}`)}
              onDoubleClick={() => onCheckoutRemote(fullRef)}
              onContextMenu={(e) => onContextMenu(e, fullRef, 'remote')}
              onRefDrop={onRefDrop}
            />
          )
        })}
      </div>
    </details>
  )
}

function BranchRow({
  name,
  fullRef,
  isCurrent,
  isSelected,
  isRemote = false,
  onSelect,
  onDoubleClick,
  onContextMenu,
  onRefDrop,
}: {
  name: string
  fullRef: string
  isCurrent: boolean
  isSelected: boolean
  isRemote?: boolean
  onSelect: () => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onRefDrop: (e: React.MouseEvent, source: string, target: string) => void
}) {
  const [dragOver, setDragOver] = useState(false)

  const handleDragOver = (e: React.DragEvent<HTMLButtonElement>) => {
    if (!e.dataTransfer.types.includes(REF_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!dragOver) setDragOver(true)
  }
  const handleDragLeave = () => setDragOver(false)
  const handleDrop = (e: React.DragEvent<HTMLButtonElement>) => {
    setDragOver(false)
    const source = e.dataTransfer.getData(REF_DRAG_MIME)
    if (!source || source === fullRef) return
    e.preventDefault()
    onRefDrop(e as unknown as React.MouseEvent, source, fullRef)
  }

  return (
    <button
      className={`sb-item ${isSelected ? 'selected' : ''} ${isCurrent ? 'current' : ''} ${dragOver ? 'drop-target' : ''}`}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      title={name}
      style={isRemote ? { paddingLeft: 28 } : undefined}
    >
      <span className="sb-item-icon">{isCurrent ? '✓' : (isRemote ? '↳' : '○')}</span>
      <span className="sb-item-label truncate" style={isCurrent ? { fontWeight: 600 } : undefined}>
        {name}
      </span>
    </button>
  )
}

function SidebarItem({
  label,
  icon,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
  title,
}: {
  label: string
  icon: string
  selected: boolean
  onClick: () => void
  onDoubleClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  title?: string
}) {
  return (
    <button
      className={`sb-item ${selected ? 'selected' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      title={title ?? label}
    >
      <span className="sb-item-icon">{icon}</span>
      <span className="sb-item-label truncate">{label}</span>
    </button>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupRemoteBranches(remoteBranches: BranchInfo[]): { remote: string; items: BranchInfo[] }[] {
  const map = new Map<string, BranchInfo[]>()
  for (const b of remoteBranches) {
    // Skip the conventional "origin/HEAD" alias
    if (b.name.endsWith('/HEAD')) continue
    const remote = b.name.split('/')[0]
    if (!map.has(remote)) map.set(remote, [])
    map.get(remote)!.push(b)
  }
  return Array.from(map.entries()).map(([remote, items]) => ({ remote, items }))
}
