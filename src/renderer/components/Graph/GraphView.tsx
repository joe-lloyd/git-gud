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
import type { CommitNode } from "../../../preload/index";
import "./GraphView.css";

const ROW_H = 36; // px per commit row
const NODE_R = 5; // node circle radius
const LANE_W = 18; // px per lane column
const GRAPH_PAD = 10; // left padding
const REFS_W = 180; // width of the refs/tags column (left of tree)

// How many rows to render outside the visible viewport (buffer)
const OVERSCAN = 8;

interface GraphViewProps {
  commits: CommitNode[];
  selectedSha: string | null;
  onSelectCommit: (sha: string) => void;
  onContextMenu?: (e: React.MouseEvent, sha: string) => void;
  /** Branches currently checked out in a worktree (branch name, no remote prefix) */
  worktreeBranches?: Set<string>;
}

export const GraphView: React.FC<GraphViewProps> = ({
  commits,
  selectedSha,
  onSelectCommit,
  onContextMenu,
  worktreeBranches = new Set(),
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);

  // Build graph layout (memoized — only recalculates when commits change)
  const nodes = useMemo(() => buildGraphLayout(commits), [commits]);

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

  // Draw canvas (lines + circles only — NO text)
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = graphWidth;
    const H = viewHeight;

    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const rowMap = new Map<number, GraphNode>();
    nodes.forEach((n) => rowMap.set(n.row, n));

    // ── Draw connections ──────────────────────────────────────────────
    for (let r = startRow; r <= endRow; r++) {
      const node = rowMap.get(r);
      if (!node) continue;

      const cy = r * ROW_H + ROW_H / 2 - scrollTop;
      const cx = GRAPH_PAD + node.lane * LANE_W + NODE_R;

      for (const conn of node.parentConnections) {
        const pr = conn.parentRow;
        if (pr < 0) continue;

        const py = pr * ROW_H + ROW_H / 2 - scrollTop;
        const px = GRAPH_PAD + conn.parentLane * LANE_W + NODE_R;

        ctx.strokeStyle = conn.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.85;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(cx, cy);

        if (Math.abs(cx - px) < 1) {
          // Same lane — straight vertical
          ctx.lineTo(px, py);
        } else {
          // Different lane — elbow with soft rounded corners (radius 4px)
          const r = 4;
          const midY = Math.round((cy + py) / 2);
          ctx.arcTo(cx, midY, px, midY, r); // corner 1: vertical→horizontal
          ctx.arcTo(px, midY, px, py, r); // corner 2: horizontal→vertical
          ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // ── Draw nodes ────────────────────────────────────────────────────
    for (let r = startRow; r <= endRow; r++) {
      const node = rowMap.get(r);
      if (!node) continue;

      const cy = r * ROW_H + ROW_H / 2 - scrollTop;
      const cx = GRAPH_PAD + node.lane * LANE_W + NODE_R;
      const isSelected = node.commit.sha === selectedSha;
      const radius = isSelected ? NODE_R + 1.5 : NODE_R;

      if (isSelected) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
        ctx.fillStyle = `${node.color}30`;
        ctx.fill();
      }

      // Outer circle
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      if (isSelected) {
        ctx.shadowColor = node.color;
        ctx.shadowBlur = 10;
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      // Inner dot
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fill();
    }
  }, [nodes, scrollTop, viewHeight, graphWidth, selectedSha, startRow, endRow]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const topSpacerH = startRow * ROW_H;
  const bottomSpacerH = Math.max(0, (nodes.length - 1 - endRow) * ROW_H);
  const visibleNodes = nodes.slice(startRow, endRow + 1);

  return (
    <div className="graph-view" ref={containerRef}>
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

      {/* Scrollable body */}
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
              isSelected={node.commit.sha === selectedSha}
              onSelect={onSelectCommit}
              onContextMenu={onContextMenu}
              worktreeBranches={worktreeBranches}
              graphWidth={graphWidth}
            />
          ))}

          {bottomSpacerH > 0 && <div style={{ height: bottomSpacerH }} />}
        </div>
      </div>
    </div>
  );
};

// ── Commit Row (pure DOM, crisp text at any DPR) ──────────────────────────────

interface CommitRowProps {
  node: GraphNode;
  isSelected: boolean;
  onSelect: (sha: string) => void;
  onContextMenu?: (e: React.MouseEvent, sha: string) => void;
  worktreeBranches: Set<string>;
  graphWidth: number;
}

const CommitRow: React.FC<CommitRowProps> = React.memo(
  ({ node, isSelected, onSelect, onContextMenu, worktreeBranches, graphWidth }) => {
    const { commit } = node;
    const groups = useMemo(
      () => groupRefs(commit.refs, worktreeBranches),
      [commit.refs, worktreeBranches],
    );

    return (
      <div
        className={`commit-row ${isSelected ? "selected" : ""}`}
        style={{ height: ROW_H }}
        onClick={() => onSelect(commit.sha)}
        onContextMenu={
          onContextMenu ? (e) => onContextMenu(e, commit.sha) : undefined
        }
      >
        {/* Refs — LEFTMOST column, left of the tree canvas */}
        <div className="cr-refs">
          {groups.map((g) => (
            <RefPill key={g.key} group={g} />
          ))}
        </div>

        {/* Transparent gap — sits directly under the canvas overlay */}
        <div style={{ width: graphWidth, flexShrink: 0 }} />

        {/* Message */}
        <span className="cr-message" title={commit.message}>
          {commit.message}
        </span>

        {/* Author */}
        <span className="cr-author" title={commit.author}>
          {commit.author}
        </span>

        {/* Date */}
        <span className="cr-date">{formatRelativeDate(commit.date)}</span>

        {/* SHA */}
        <span className="cr-sha mono">{commit.shortSha}</span>
      </div>
    );
  },
);

CommitRow.displayName = "CommitRow";

// ── Ref grouping ──────────────────────────────────────────────────────────────

interface RefGroup {
  key: string;
  name: string; // display name, e.g. "main"
  isHead: boolean; // HEAD points here
  hasLocal: boolean; // local branch with this name exists
  hasRemote: boolean; // remote/*/name exists
  isTag: boolean; // tag
  hasWorktree: boolean; // checked out in a worktree
  tooltip: string; // full list of raw refs
}

/**
 * Groups the flat refs string array into logical ref groups.
 * E.g. ["HEAD", "main", "origin/main"] → one group {name:"main", isHead, hasLocal, hasRemote}
 * Tags stay as individual groups.
 */
function groupRefs(refs: string[], worktreeBranches: Set<string>): RefGroup[] {
  const groups = new Map<string, RefGroup>();
  let headTarget: string | null = null;

  // First pass: find HEAD → branch mapping
  // git log --decorate gives "HEAD -> main" but our parser splits them into
  // separate strings: "HEAD" and "main". HEAD always appears right before
  // the branch it points to, so we track it separately.
  for (const ref of refs) {
    if (ref === "HEAD") {
      headTarget = "HEAD_standalone";
      continue;
    }
    if (ref.startsWith("tag: ")) continue;
    // The first non-HEAD, non-tag ref after HEAD is what HEAD points to
    if (headTarget === "HEAD_standalone") {
      headTarget = branchBaseName(ref);
      break;
    }
  }

  // Second pass: build groups
  for (const ref of refs) {
    if (ref === "HEAD") continue; // handled via headTarget

    if (ref.startsWith("tag: ")) {
      const tagName = ref.slice(5);
      groups.set(ref, {
        key: ref,
        name: tagName,
        isHead: false,
        hasLocal: false,
        hasRemote: false,
        isTag: true,
        hasWorktree: false,
        tooltip: ref,
      });
      continue;
    }

    const base = branchBaseName(ref);
    const isRemote = ref.includes("/") && !ref.startsWith("HEAD");

    if (!groups.has(base)) {
      groups.set(base, {
        key: base,
        name: base,
        isHead: base === headTarget,
        hasLocal: !isRemote,
        hasRemote: isRemote,
        isTag: false,
        hasWorktree: worktreeBranches.has(base),
        tooltip: ref,
      });
    } else {
      const g = groups.get(base)!;
      if (isRemote) g.hasRemote = true;
      else g.hasLocal = true;
      g.tooltip += `, ${ref}`;
    }
  }

  // If HEAD was standalone (detached), add a HEAD group
  if (headTarget === "HEAD_standalone") {
    groups.set("HEAD", {
      key: "HEAD",
      name: "HEAD",
      isHead: true,
      hasLocal: false,
      hasRemote: false,
      isTag: false,
      hasWorktree: false,
      tooltip: "HEAD (detached)",
    });
  }

  return Array.from(groups.values());
}

/** Extract the short branch name from any ref form */
function branchBaseName(ref: string): string {
  // remote ref: origin/main, upstream/feature/foo → take everything after first segment
  if (ref.includes("/")) {
    const parts = ref.split("/");
    // drop the remote name (first segment), rejoin the rest
    return parts.slice(1).join("/");
  }
  return ref;
}

// ── RefPill component ─────────────────────────────────────────────────────────

function RefPill({ group }: { group: RefGroup }) {
  const [tipPos, setTipPos] = useState<{ x: number; bottom: number } | null>(null);

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

  return (
    <>
      <span
        className={cls}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
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
