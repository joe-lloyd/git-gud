import React, { useState, useEffect } from 'react'
import type { BranchData, StashInfo, RemoteInfo, TagInfo, BranchInfo, WorktreeInfo } from '../../../preload/index'
import { REF_DRAG_MIME } from '../Graph/GraphView'
import './Sidebar.css'

// Resizable sidebar sections — each section body has a drag-set height and its
// own scroll, mirroring the staged/unstaged splitter in the right panel.
const SECTION_MIN = 56
const SECTION_MAX = 720
const DEFAULT_HEIGHTS: Record<string, number> = { local: 200, remote: 160, stashes: 120, worktrees: 120, tags: 140 }
const HEIGHTS_KEY = 'sidebar.sectionHeights'

interface SidebarProps {
  repoPath: string | null
  branches: BranchData
  stashes: StashInfo[]
  tags: TagInfo[]
  remotes: RemoteInfo[]
  worktrees: WorktreeInfo[]
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
  onWorktreeClick: (path: string) => void
  onWorktreeContextMenu: (e: React.MouseEvent, path: string, isMain: boolean) => void
  onWorktreeManage: () => void
  /** Drop a ref pill (from graph) onto a sidebar branch row */
  onRefDrop: (e: React.MouseEvent, source: string, target: string) => void
}

export const Sidebar: React.FC<SidebarProps> = ({
  repoPath,
  branches,
  stashes,
  tags,
  remotes,
  worktrees,
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
  onWorktreeClick,
  onWorktreeContextMenu,
  onWorktreeManage,
  onRefDrop,
}) => {
  const repoName = repoPath ? repoPath.split('/').pop() : null

  // Group remote branches by remote (first path segment)
  const remoteGroups = groupRemoteBranches(branches.remote)

  // Persisted per-section heights; each divider drag adjusts the section above.
  const [heights, setHeights] = useState<Record<string, number>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(HEIGHTS_KEY) || 'null')
      if (saved && typeof saved === 'object') return { ...DEFAULT_HEIGHTS, ...saved }
    } catch { /* ignore malformed */ }
    return DEFAULT_HEIGHTS
  })
  useEffect(() => { localStorage.setItem(HEIGHTS_KEY, JSON.stringify(heights)) }, [heights])

  const resize = (key: string) => (delta: number) =>
    setHeights((h) => ({
      ...h,
      [key]: Math.min(SECTION_MAX, Math.max(SECTION_MIN, (h[key] ?? DEFAULT_HEIGHTS[key]) + delta)),
    }))

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
        {/* Local Branches — one scrollable list of every local branch */}
        <ScrollSection label="LOCAL BRANCHES" count={branches.local.length} height={heights.local}>
          {branches.local.length === 0
            ? <div className="sb-empty">No local branches</div>
            : sortBranchesCurrentFirst(branches.local, currentBranch).map((b) => (
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
              ))}
        </ScrollSection>

        <SectionResizer onResize={resize('local')} />

        {/* Remote Branches — grouped by remote */}
        <ScrollSection label="REMOTE BRANCHES" count={branches.remote.length} height={heights.remote}>
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
        </ScrollSection>

        <SectionResizer onResize={resize('remote')} />

        {/* Stashes */}
        <ScrollSection label="STASHES" count={stashes.length} height={heights.stashes}>
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
        </ScrollSection>

        <SectionResizer onResize={resize('stashes')} />

        {/* Worktrees — list all checkouts, click to switch, right-click to manage */}
        <ScrollSection
          label="WORKTREES"
          count={worktrees.length}
          height={heights.worktrees}
          action={{ label: '+', title: 'Manage worktrees…', onClick: onWorktreeManage }}
        >
          {worktrees.length === 0
            ? <div className="sb-empty">No worktrees</div>
            : worktrees.map((w) => {
                const name = w.path.split('/').pop() || w.path
                const isCurrent = w.path === repoPath
                return (
                  <SidebarItem
                    key={w.path}
                    label={`${w.branch || 'detached'}${w.isMain ? '  (main)' : ''}`}
                    icon={isCurrent ? '◉' : '⊞'}
                    selected={isCurrent}
                    onClick={() => onWorktreeClick(w.path)}
                    onContextMenu={(e) => onWorktreeContextMenu(e, w.path, w.isMain)}
                    title={`${name}\n${w.path}\n→ ${w.branch || 'detached'} @ ${w.sha.slice(0, 7)}`}
                  />
                )
              })
          }
        </ScrollSection>

        <SectionResizer onResize={resize('worktrees')} />

        {/* Tags — full scrollable list, same treatment as every other section */}
        <ScrollSection label="TAGS" count={tags.length} height={heights.tags}>
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
        </ScrollSection>
      </nav>
    </aside>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

// A sidebar section with a fixed (drag-resizable) body height and its own
// scroll. The resize handle between sections is rendered by `SectionResizer`.
function ScrollSection({
  label,
  count,
  height,
  action,
  children,
}: {
  label: string
  count: number
  height: number
  action?: { label: string; title: string; onClick: () => void }
  children: React.ReactNode
}) {
  return (
    <div className="sb-section sb-rsection">
      <div className="sb-section-header">
        <span className="sb-section-label">{label}</span>
        <span className="sb-count">{count}</span>
        {action && (
          <button
            className="sb-section-action"
            title={action.title}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); action.onClick() }}
          >
            {action.label}
          </button>
        )}
      </div>
      <div className="sb-rsection-body" style={{ height }}>{children}</div>
    </div>
  )
}

// Horizontal drag handle between sidebar sections. Reports an incremental
// delta (px moved since the last event) so the parent clamps as it applies it
// to the section above. Same look/feel as the staged/unstaged splitter.
function SectionResizer({ onResize }: { onResize: (delta: number) => void }) {
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    let last = e.clientY
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent) => { onResize(ev.clientY - last); last = ev.clientY }
    const onUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  return (
    <div className="panel-resize-handle panel-resize-handle--h" onMouseDown={startDrag} title="Drag to resize">
      <div className="panel-resize-grip panel-resize-grip--h" />
    </div>
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

function sortBranchesCurrentFirst(items: BranchInfo[], currentBranch: string): BranchInfo[] {
  return [...items].sort((a, b) => {
    const aCur = a.current || a.name === currentBranch
    const bCur = b.current || b.name === currentBranch
    if (aCur && !bCur) return -1
    if (!aCur && bCur) return 1
    return a.name.localeCompare(b.name)
  })
}

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
