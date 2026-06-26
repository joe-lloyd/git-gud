/**
 * GraphView — Hybrid DOM + Canvas approach:
 *  - Canvas: sticky left panel drawing ONLY graph lines + node circles (DPR-aware)
 *  - DOM: virtualized list of commit rows with real HTML text, ref pills, etc.
 *
 * This gives pixel-perfect, crisp text at all DPR values while keeping
 * the graph lane rendering fast via Canvas.
 */

import React, { useRef, useState, useCallback, useMemo } from "react";
import { buildGraphLayout, GraphNode } from "./graphLayout";
import type { CommitNode, StashInfo } from "../../../preload/index";
import { RefGroup, groupRefs, pickPrimaryRefGroup } from "../../lib/refs";
import "./GraphView.css";

const ROW_H = 36; // px per commit row
const NODE_R = 10; // node circle radius — matches the .cr-lead band height (20px diameter)
const LANE_W = 18; // px per lane column
const GRAPH_PAD = 10; // left padding
const REFS_W = 180; // width of the refs/tags column (left of tree)

// How many rows to render outside the visible viewport (buffer)
const OVERSCAN = 8;

// Sentinel SHA for the synthetic "uncommitted changes" node prepended above
// HEAD when the working tree is dirty. Never collides with a real 40-char SHA.
export const WORKTREE_SHA = "__WORKTREE__";

export function makeWorktreePseudoCommit(parentSha: string, dirtyCount: number): CommitNode {
  const label = dirtyCount > 0
    ? `Uncommitted changes (${dirtyCount})`
    : "Uncommitted changes";
  return {
    sha: WORKTREE_SHA,
    shortSha: "•••••••",
    message: label,
    author: "",
    email: "",
    date: "",
    timestamp: 0,
    parents: parentSha ? [parentSha] : [],
    refs: [],
  };
}

// Modifier keys carried with a row click so the parent can do range / toggle
// multi-selection (shift = contiguous range from anchor, meta/ctrl = toggle).
export interface SelectModifiers { shift?: boolean; meta?: boolean }

interface GraphViewProps {
  commits: CommitNode[];
  selectedSha: string | null;
  /** All selected SHAs when multi-selecting; highlights every member. */
  selectedShas?: Set<string>;
  onSelectCommit: (sha: string, mods?: SelectModifiers) => void;
  onContextMenu?: (e: React.MouseEvent, sha: string) => void;
  /** Right-click on a branch/tag pill */
  onRefContextMenu?: (e: React.MouseEvent, ref: string, kind: 'local' | 'remote' | 'tag') => void;
  /** A pill was dragged onto another (or onto a sidebar branch) — caller opens the action menu */
  onRefDrop?: (e: React.MouseEvent, source: string, target: string) => void;
  /** Branches currently checked out in a worktree (branch name, no remote prefix) */
  worktreeBranches?: Set<string>;
  /** Stashes — used to render stash nodes with a distinct icon and dashed parent links */
  stashes?: StashInfo[];
  /**
   * Monotonic counter the parent bumps ONLY when the selection should scroll
   * into view (a branch/tag/stash picked in the sidebar). Selecting a commit by
   * clicking the graph must NOT scroll, so this is decoupled from selectedSha.
   */
  scrollRequest?: number;
}

export const GraphView: React.FC<GraphViewProps> = ({
  commits,
  selectedSha,
  selectedShas,
  scrollRequest = 0,
  onSelectCommit,
  onContextMenu,
  onRefContextMenu,
  onRefDrop,
  worktreeBranches = new Set(),
  stashes = [],
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);
  // Live scroll offset for the canvas. We draw from this ref (not the React
  // state) so the graph lines repaint in lockstep with native scroll via rAF,
  // instead of trailing a render commit. The state above still drives DOM row
  // virtualization.
  const scrollTopRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  // Stash SHA lookup — drives the diamond node + dashed parent links, and tells
  // the layout to give each stash its own dedicated column (so a stash never
  // reuses an unrelated commit's freed lane and looks falsely connected).
  const stashShaSet = useMemo(
    () => new Set(stashes.map((s) => s.sha)),
    [stashes],
  );

  // Build graph layout (memoized — recalculates when commits or stashes change).
  const nodes = useMemo(() => buildGraphLayout(commits, stashShaSet), [commits, stashShaSet]);

  const numLanes = useMemo(
    () => nodes.reduce((m, n) => Math.max(m, n.lane), 0) + 1,
    [nodes],
  );
  const graphWidth = GRAPH_PAD + numLanes * LANE_W + LANE_W / 2;
  const totalHeight = commits.length * ROW_H;

  // Visible row range with overscan
  const startRow = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const endRow = Math.min(
    nodes.length - 1,
    Math.ceil((scrollTop + viewHeight) / ROW_H) + OVERSCAN,
  );

  // sha → row index, used to scroll the selected commit into view when a
  // sidebar ref (e.g. a stash) jumps the selection from outside the graph.
  const shaToRow = useMemo(() => {
    const m = new Map<string, number>();
    nodes.forEach((n) => m.set(n.commit.sha, n.row));
    return m;
  }, [nodes]);

  // Auto-scroll the selected commit into view — ONLY when the parent bumps
  // `scrollRequest` (a sidebar branch/tag/stash pick). Clicking a node in the
  // graph changes selectedSha but does NOT bump it, so it never auto-scrolls.
  const lastScrollReq = useRef(scrollRequest);
  React.useEffect(() => {
    if (scrollRequest === lastScrollReq.current) return; // selection changed without a scroll request
    lastScrollReq.current = scrollRequest;
    if (!selectedSha) return;
    const row = shaToRow.get(selectedSha);
    if (row === undefined) return;
    const el = scrollRef.current;
    if (!el) return;
    const target = row * ROW_H;
    // Only scroll if the row is outside the visible band.
    const inView = target >= el.scrollTop && target + ROW_H <= el.scrollTop + el.clientHeight;
    if (inView) return;
    el.scrollTo({ top: Math.max(0, target - el.clientHeight / 2 + ROW_H / 2), behavior: "smooth" });
  }, [scrollRequest, selectedSha, shaToRow]);

  // Track container size
  const containerRef = useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewHeight(el.clientHeight));
    ro.observe(el);
    setViewHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Draw canvas (lines + circles only — NO text). Reads the live scroll offset
  // from scrollTopRef so it can be invoked synchronously inside a scroll rAF.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = graphWidth;
    const H = viewHeight;
    const st = scrollTopRef.current;

    // Only reallocate the bitmap when the size actually changes — resetting
    // canvas.width every scroll frame is needless churn. clearRect handles the
    // per-frame wipe.
    const pxW = Math.round(W * dpr);
    const pxH = Math.round(H * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // ── Draw connections ──────────────────────────────────────────────
    // Iterate ALL nodes and cull per-connection by whether the segment crosses
    // the viewport vertically. A connector must be drawn whenever any part of
    // it is on screen — even if BOTH its endpoint rows are scrolled out of the
    // virtualized band — otherwise long edges vanish mid-scroll.
    for (const node of nodes) {
      const cy = node.row * ROW_H + ROW_H / 2 - st;
      const cx = GRAPH_PAD + node.lane * LANE_W + NODE_R;
      const fromStash = stashShaSet.has(node.commit.sha);
      const fromPseudo = node.commit.sha === WORKTREE_SHA;

      for (const conn of node.parentConnections) {
        const pr = conn.parentRow;
        if (pr < 0) continue;

        const py = pr * ROW_H + ROW_H / 2 - st;
        // Skip only when the whole segment is off-screen above or below.
        if (Math.max(cy, py) < -ROW_H || Math.min(cy, py) > H + ROW_H) continue;
        const px = GRAPH_PAD + conn.parentLane * LANE_W + NODE_R;

        // Lines hanging off a stash or working-tree node are dashed — they
        // mark off-history dangles, not real commit lineage.
        const toStash = stashShaSet.has(conn.parentSha);
        const dashed = fromStash || toStash || fromPseudo;

        ctx.strokeStyle = conn.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = dashed ? 0.7 : 0.85;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (dashed) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);

        if (Math.abs(cx - px) < 1) {
          // Same lane — straight vertical
          ctx.lineTo(px, py);
        } else {
          // Different lane — single 90° elbow so one end enters its node from
          // the SIDE (clear merge/fork visual), the other from straight on.
          //   merge:  start node → horizontal → bend → vertical → parent
          //   fork :  start node → vertical   → bend → horizontal → parent
          const r = 4;
          if (conn.type === "merge") {
            ctx.arcTo(px, cy, px, py, r); // corner at (px, cy)
          } else {
            ctx.arcTo(cx, py, px, py, r); // corner at (cx, py)
          }
          ctx.lineTo(px, py);
        }
        ctx.stroke();
        if (dashed) ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    // ── Draw nodes ────────────────────────────────────────────────────
    for (const node of nodes) {
      const cy = node.row * ROW_H + ROW_H / 2 - st;
      if (cy < -ROW_H || cy > H + ROW_H) continue; // off-screen — skip

      const cx = GRAPH_PAD + node.lane * LANE_W + NODE_R;
      const isSelected = node.commit.sha === selectedSha || (selectedShas?.has(node.commit.sha) ?? false);
      const isStash = stashShaSet.has(node.commit.sha);
      const isPseudo = node.commit.sha === WORKTREE_SHA;
      const radius = isSelected ? NODE_R + 1.5 : NODE_R;

      if (isSelected) {
        ctx.beginPath();
        if (isStash) {
          const g = radius + 3;
          ctx.moveTo(cx, cy - g);
          ctx.lineTo(cx + g, cy);
          ctx.lineTo(cx, cy + g);
          ctx.lineTo(cx - g, cy);
          ctx.closePath();
        } else {
          ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
        }
        ctx.fillStyle = `${node.color}30`;
        ctx.fill();
      }

      if (isSelected) {
        ctx.shadowColor = node.color;
        ctx.shadowBlur = 10;
      }

      if (isPseudo) {
        // Hollow dashed ring — signals "not a real commit yet"
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = node.color;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (isStash) {
        // Diamond (rotated square) — distinguishes stash from real commits
        const g = radius + 0.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy - g);
        ctx.lineTo(cx + g, cy);
        ctx.lineTo(cx, cy + g);
        ctx.lineTo(cx - g, cy);
        ctx.closePath();
        ctx.fillStyle = node.color;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Outline
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.stroke();

        // Inner "S" mark via a small horizontal bar to read as "stack"
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(cx - radius * 0.44, cy - radius * 0.16, radius * 0.88, radius * 0.32);
      } else {
        // Ring node: a neutral interior (placeholder for a future avatar) with a
        // thin lane-colored border. Diameter is unchanged — only the line is thin.
        const lw = 2; // ring line thickness
        ctx.beginPath();
        ctx.arc(cx, cy, radius - lw / 2, 0, Math.PI * 2);
        ctx.fillStyle = "#0d1117"; // --bg-deepest — sits behind a profile photo
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = lw;
        ctx.strokeStyle = node.color;
        ctx.stroke();
      }
    }
  }, [nodes, viewHeight, graphWidth, selectedSha, selectedShas, stashShaSet]);

  // Repaint on data / size / selection changes (anything in `draw`'s deps).
  // Scroll-driven repaints go through the rAF in handleScroll instead.
  React.useEffect(() => { draw(); }, [draw]);

  // Cancel any pending scroll frame on unmount.
  React.useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const st = e.currentTarget.scrollTop;
    scrollTopRef.current = st;
    // Repaint the canvas in lockstep with native scroll (next frame, coalesced),
    // independent of the React render that updates row virtualization.
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => { rafRef.current = null; draw(); });
    }
    setScrollTop(st);
  }, [draw]);

  const topSpacerH = startRow * ROW_H;
  const bottomSpacerH = Math.max(0, (nodes.length - 1 - endRow) * ROW_H);
  const visibleNodes = nodes.slice(startRow, endRow + 1);

  return (
    <div className="graph-view" ref={containerRef}>
      {/* One horizontal scroller wraps header + body so they pan in lockstep */}
      <div className="graph-h-scroll">
        <div className="graph-h-inner">
          {/* Column headers */}
          <div className="graph-header">
            <div style={{ width: REFS_W, flexShrink: 0, padding: "0 4px" }}>Branches / Tags</div>
            <div style={{ width: graphWidth, flexShrink: 0 }} />
            <div className="gh-message">Commit Message</div>
            <div className="gh-author">Author</div>
            <div className="gh-date">Date</div>
            <div className="gh-sha">SHA</div>
          </div>
          <div className="divider" />

          {/* Scrollable body — vertical only; horizontal handled by outer wrapper */}
          <div className="graph-scroll" ref={scrollRef} onScroll={handleScroll}>
            {/* Canvas — absolutely overlaid on the graph-gap zone at left: REFS_W */}
            <div className="graph-canvas-wrap" style={{ left: REFS_W, width: graphWidth, height: totalHeight }}>
              <canvas ref={canvasRef} className="graph-canvas" />
            </div>

            {/* Virtualized full-width rows: [refs][gap][message][author][date][sha] */}
            <div className="graph-rows">
              {topSpacerH > 0 && <div style={{ height: topSpacerH }} />}

              {visibleNodes.map((node) => (
                <CommitRow
                  key={node.commit.sha}
                  node={node}
                  isSelected={node.commit.sha === selectedSha || (selectedShas?.has(node.commit.sha) ?? false)}
                  isStash={stashShaSet.has(node.commit.sha)}
                  isPseudo={node.commit.sha === WORKTREE_SHA}
                  onSelect={onSelectCommit}
                  onContextMenu={onContextMenu}
                  onRefContextMenu={onRefContextMenu}
                  onRefDrop={onRefDrop}
                  worktreeBranches={worktreeBranches}
                  graphWidth={graphWidth}
                />
              ))}

              {bottomSpacerH > 0 && <div style={{ height: bottomSpacerH }} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Commit Row (pure DOM, crisp text at any DPR) ──────────────────────────────

interface CommitRowProps {
  node: GraphNode;
  isSelected: boolean;
  isStash: boolean;
  isPseudo: boolean;
  onSelect: (sha: string, mods?: SelectModifiers) => void;
  onContextMenu?: (e: React.MouseEvent, sha: string) => void;
  onRefContextMenu?: (e: React.MouseEvent, ref: string, kind: 'local' | 'remote' | 'tag') => void;
  onRefDrop?: (e: React.MouseEvent, source: string, target: string) => void;
  worktreeBranches: Set<string>;
  graphWidth: number;
}

const CommitRow: React.FC<CommitRowProps> = React.memo(
  ({ node, isSelected, isStash, isPseudo, onSelect, onContextMenu, onRefContextMenu, onRefDrop, worktreeBranches, graphWidth }) => {
    const { commit } = node;
    const groups = useMemo(
      () => isPseudo ? [] : groupRefs(commit.refs, worktreeBranches),
      [commit.refs, worktreeBranches, isPseudo],
    );

    // Left edge of this row's node (its left rim) within the graph gap — the
    // connector band starts here so it tucks behind the node.
    const nodeLeft = GRAPH_PAD + node.lane * LANE_W;

    return (
      <div
        className={`commit-row ${isSelected ? "selected" : ""} ${isStash ? "is-stash" : ""} ${isPseudo ? "is-pseudo" : ""}`}
        style={{ height: ROW_H, ["--row-tint" as string]: node.color } as React.CSSProperties}
        onClick={(e) => onSelect(commit.sha, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })}
        onContextMenu={
          !isPseudo && onContextMenu ? (e) => onContextMenu(e, commit.sha) : undefined
        }
      >
        {/* Refs — LEFTMOST column, left of the tree canvas. Collapsed to one
            pill + a "+N" overflow chip so the fixed-width column never spills. */}
        <div className="cr-refs">
          {isStash && <span className="cr-stash-badge" title="Stash">◆</span>}
          <RefPillCluster
            groups={groups}
            onContextMenu={onRefContextMenu}
            onRefDrop={onRefDrop}
          />
        </div>

        {/* Graph gap — sits under the canvas overlay. The lane-colored band
            fills from the node out to the message, tucking behind the node so it
            reads as a thick connector line. */}
        <div className="cr-gap" style={{ width: graphWidth, flexShrink: 0 }}>
          {!isPseudo && <span className="cr-lead" style={{ left: nodeLeft }} />}
        </div>

        {/* Message */}
        <span className="cr-message" title={commit.message}>
          {commit.message}
        </span>

        {/* Author */}
        <span className="cr-author" title={commit.author}>
          {commit.author}
        </span>

        {/* Date */}
        <span className="cr-date">{isPseudo ? "" : formatRelativeDate(commit.date)}</span>

        {/* SHA */}
        <span className="cr-sha mono">{isPseudo ? "" : commit.shortSha}</span>
      </div>
    );
  },
);

CommitRow.displayName = "CommitRow";

// ── RefPillCluster — one pill + "+N" overflow ─────────────────────────────────

// Shows a single representative pill and, when a commit carries more than one
// ref, a "+N" chip. Hovering the chip reveals every pill (branch / HEAD / tag /
// remote / worktree) in a popover that escapes the clipped refs column.
function RefPillCluster({
  groups,
  onContextMenu,
  onRefDrop,
}: {
  groups: RefGroup[];
  onContextMenu?: (e: React.MouseEvent, ref: string, kind: 'local' | 'remote' | 'tag') => void;
  onRefDrop?: (e: React.MouseEvent, source: string, target: string) => void;
}) {
  const [pos, setPos] = useState<{ x: number; top: number } | null>(null);
  const closeTimer = useRef<number | null>(null);

  if (groups.length === 0) return null;

  // Pick the most meaningful pill to show (current HEAD, then local, then tag).
  const primary = pickPrimaryRefGroup(groups)!;
  const rest = groups.length - 1;

  if (rest <= 0) {
    return <RefPill group={primary} onContextMenu={onContextMenu} onRefDrop={onRefDrop} />;
  }

  const open = (e: React.MouseEvent<HTMLElement>) => {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ x: r.left, top: r.bottom + 6 });
  };
  const scheduleClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setPos(null), 120);
  };

  return (
    <>
      <RefPill group={primary} onContextMenu={onContextMenu} onRefDrop={onRefDrop} />
      <span
        className="ref-pill ref-more"
        onMouseEnter={open}
        onMouseLeave={scheduleClose}
        title={`${rest} more ref${rest === 1 ? '' : 's'}`}
      >
        +{rest}
      </span>
      {pos && (
        <div
          className="ref-cluster-popover"
          style={{ left: pos.x, top: pos.top }}
          onMouseEnter={open}
          onMouseLeave={scheduleClose}
        >
          {groups.map((g) => (
            <RefPill key={g.key} group={g} onContextMenu={onContextMenu} onRefDrop={onRefDrop} />
          ))}
        </div>
      )}
    </>
  );
}

// ── RefPill component ─────────────────────────────────────────────────────────

// MIME for our drag payload — distinct from any browser-native DnD
export const REF_DRAG_MIME = "application/x-git-ref";

function RefPill({
  group,
  onContextMenu,
  onRefDrop,
}: {
  group: RefGroup;
  onContextMenu?: (e: React.MouseEvent, ref: string, kind: 'local' | 'remote' | 'tag') => void;
  onRefDrop?: (e: React.MouseEvent, source: string, target: string) => void;
}) {
  const [tipPos, setTipPos] = useState<{ x: number; bottom: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTipPos({ x: r.left, bottom: window.innerHeight - r.top + 8 });
  };
  const handleMouseLeave = () => setTipPos(null);

  // Build tooltip lines
  const lines: string[] = [];
  if (group.isTag)  lines.push("🏷  tag");
  if (group.isHead) lines.push("◉  current HEAD");
  if (group.hasLocal  && !group.isTag) lines.push("⎇  local branch");
  if (group.hasRemote && !group.isTag) lines.push("↑  remote branch");
  if (group.hasWorktree) lines.push("⊞  checked out in worktree");
  lines.push(group.tooltip);

  const isTag = group.isTag;
  const cls = isTag
    ? "ref-pill ref-tag"
    : group.isHead
    ? "ref-pill ref-head"
    : group.hasLocal && group.hasRemote
    ? "ref-pill ref-both"
    : group.hasRemote
    ? "ref-pill ref-remote"
    : "ref-pill ref-local";

  // Tags can't be merge/rebase/checkout sources.
  // Local branches are draggable; remote branches are draggable (we'll auto-create
  // a local tracking branch on the action side if needed).
  const isDraggable = !isTag;
  const kind: 'local' | 'remote' | 'tag' = isTag ? 'tag' : (group.hasRemote && !group.hasLocal ? 'remote' : 'local');
  // The full ref name git understands: local branch keeps its name; remote pill
  // uses the raw "remote/name" form from the tooltip.
  const refName = isTag
    ? group.name  // tag name, not used for DnD
    : (group.hasLocal ? group.name : (group.tooltip.split(',')[0]?.trim() ?? group.name));

  const handleDragStart = (e: React.DragEvent<HTMLElement>) => {
    if (!isDraggable) return;
    e.stopPropagation();
    setTipPos(null);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(REF_DRAG_MIME, refName);
    e.dataTransfer.setData('text/plain', refName);
  };

  const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
    if (isTag) return;
    if (!e.dataTransfer.types.includes(REF_DRAG_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (!dragOver) setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    setDragOver(false);
    if (isTag) return;
    const source = e.dataTransfer.getData(REF_DRAG_MIME);
    if (!source || source === refName) return;
    e.preventDefault();
    e.stopPropagation();
    onRefDrop?.(e as unknown as React.MouseEvent, source, refName);
  };

  return (
    <>
      <span
        className={`${cls} ${dragOver ? 'ref-drop-target' : ''}`}
        draggable={isDraggable}
        onDragStart={isDraggable ? handleDragStart : undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={onContextMenu ? (e) => onContextMenu(e, refName, kind) : undefined}
        data-ref-name={refName}
      >
        {isTag          && <span className="rp-icon">🏷</span>}
        {group.isHead   && <span className="rp-icon rp-head">◉</span>}
        {group.hasLocal && !isTag && <span className="rp-icon rp-local">⎇</span>}
        {group.hasRemote && <span className="rp-icon rp-remote">↑</span>}
        {group.hasWorktree && <span className="rp-icon rp-worktree">⊞</span>}
        <span className="rp-name">{group.name}</span>
      </span>

      {tipPos && (
        <div
          className="ref-tooltip"
          style={{ left: tipPos.x, bottom: tipPos.bottom }}
        >
          <div className="ref-tooltip-name">{group.name}</div>
          {lines.slice(0, -1).map((l, i) => (
            <div key={i} className="ref-tooltip-line">{l}</div>
          ))}
          {/* raw refs on last line in muted style */}
          <div className="ref-tooltip-raw">{group.tooltip}</div>
        </div>
      )}
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeDate(isoDate: string): string {
  if (!isoDate) return "";
  const diff = Date.now() - new Date(isoDate).getTime();
  const s = diff / 1000;
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 30) return `${Math.floor(d)}d ago`;
  const mo = d / 30;
  if (mo < 12) return `${Math.floor(mo)}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
