import React, { useEffect, useRef, useCallback } from 'react'
import { buildGraphLayout, GraphNode, getLaneColor } from './graphLayout'
import type { CommitNode } from '../../../preload/index'

interface GraphCanvasProps {
  commits: CommitNode[]
  selectedSha: string | null
  onSelectCommit: (sha: string) => void
  onContextMenu?: (e: React.MouseEvent, sha: string) => void
  scrollTop: number
}

const ROW_H = 36
const NODE_R = 6
const LANE_W = 16
const GRAPH_PADDING_LEFT = 12
const FONT = "13px 'Inter', system-ui, sans-serif"
const FONT_MONO = "11px 'JetBrains Mono', monospace"

// Ref pill colors matching CSS
const REF_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  local:  { bg: 'rgba(99,179,237,0.18)',  text: '#63b3ed', border: 'rgba(99,179,237,0.3)' },
  remote: { bg: 'rgba(104,211,145,0.15)', text: '#68d391', border: 'rgba(104,211,145,0.25)' },
  tag:    { bg: 'rgba(246,173,85,0.15)',  text: '#f6ad55', border: 'rgba(246,173,85,0.25)' },
  head:   { bg: 'rgba(251,182,206,0.2)',  text: '#fbb6ce', border: 'rgba(251,182,206,0.35)' },
}

function getRefStyle(ref: string) {
  if (ref === 'HEAD') return REF_STYLES.head
  if (ref.startsWith('tag:')) return REF_STYLES.tag
  if (ref.includes('/')) return REF_STYLES.remote
  return REF_STYLES.local
}

function getRefLabel(ref: string): string {
  if (ref === 'HEAD') return 'HEAD'
  if (ref.startsWith('tag: ')) return ref.slice(5)
  // shorten remote refs: origin/main → origin/main (keep short)
  const parts = ref.split('/')
  return parts[parts.length - 1]
}

export const GraphCanvas: React.FC<GraphCanvasProps> = ({
  commits,
  selectedSha,
  onSelectCommit,
  onContextMenu,
  scrollTop,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef<GraphNode[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  const getVisibleRange = useCallback((height: number) => {
    const startRow = Math.max(0, Math.floor(scrollTop / ROW_H) - 2)
    const endRow = Math.min(
      nodesRef.current.length - 1,
      Math.ceil((scrollTop + height) / ROW_H) + 2
    )
    return { startRow, endRow }
  }, [scrollTop])

  const maxLane = useCallback(() => {
    return nodesRef.current.reduce((m, n) => Math.max(m, n.lane), 0)
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)

    const nodes = nodesRef.current
    if (nodes.length === 0) return

    const numLanes = maxLane() + 1
    const graphWidth = GRAPH_PADDING_LEFT + numLanes * LANE_W + LANE_W
    const { startRow, endRow } = getVisibleRange(H)

    // Pre-build row → node map for fast lookup
    const rowMap = new Map<number, GraphNode>()
    nodes.forEach((n) => rowMap.set(n.row, n))

    // ── Draw connections ──────────────────────────────────────────────────
    for (let r = startRow; r <= endRow; r++) {
      const node = rowMap.get(r)
      if (!node) continue

      const cy = r * ROW_H + ROW_H / 2 - scrollTop
      const cx = GRAPH_PADDING_LEFT + node.lane * LANE_W + NODE_R

      for (const conn of node.parentConnections) {
        const pr = conn.parentRow
        if (pr < 0) continue

        const py = pr * ROW_H + ROW_H / 2 - scrollTop
        const px = GRAPH_PADDING_LEFT + conn.parentLane * LANE_W + NODE_R

        ctx.strokeStyle = conn.color
        ctx.lineWidth = 2
        ctx.globalAlpha = 0.85
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(cx, cy)

        if (cx === px) {
          // Straight vertical line
          ctx.lineTo(px, py)
        } else {
          // Bezier curve for merges / forks
          const midY = (cy + py) / 2
          ctx.bezierCurveTo(cx, midY, px, midY, px, py)
        }
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }

    // ── Draw pass-through lines (active lanes between commits) ─────────────
    // Already handled by parent connections — if a parent is > 1 row away,
    // the bezier naturally bridges the gap.

    // ── Draw nodes ────────────────────────────────────────────────────────
    for (let r = startRow; r <= endRow; r++) {
      const node = rowMap.get(r)
      if (!node) continue

      const cy = r * ROW_H + ROW_H / 2 - scrollTop
      const cx = GRAPH_PADDING_LEFT + node.lane * LANE_W + NODE_R
      const isSelected = node.commit.sha === selectedSha

      // Selection highlight
      if (isSelected) {
        ctx.fillStyle = 'rgba(99,179,237,0.12)'
        ctx.fillRect(0, cy - ROW_H / 2, W, ROW_H)
      } else if (r % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.015)'
        ctx.fillRect(0, cy - ROW_H / 2, W, ROW_H)
      }

      // Circle
      ctx.beginPath()
      ctx.arc(cx, cy, isSelected ? NODE_R + 1 : NODE_R, 0, Math.PI * 2)
      ctx.fillStyle = node.color
      if (isSelected) {
        ctx.shadowColor = node.color
        ctx.shadowBlur = 8
      }
      ctx.fill()
      ctx.shadowBlur = 0

      // Inner dot (for regular commits)
      ctx.beginPath()
      ctx.arc(cx, cy, 3, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fill()

      // ── Ref pills ────────────────────────────────────────────────────────
      let pillX = graphWidth + 4
      for (const ref of node.commit.refs) {
        const label = getRefLabel(ref)
        if (!label) continue
        const style = getRefStyle(ref)

        ctx.font = `600 10px 'Inter', system-ui`
        const textW = ctx.measureText(label).width
        const pillW = textW + 14
        const pillH = 16
        const pillY = cy - pillH / 2

        // Pill background
        ctx.fillStyle = style.bg
        ctx.strokeStyle = style.border
        ctx.lineWidth = 1
        roundRect(ctx, pillX, pillY, pillW, pillH, 8)
        ctx.fill()
        ctx.stroke()

        // Pill text
        ctx.fillStyle = style.text
        ctx.fillText(label, pillX + 7, pillY + 11)

        pillX += pillW + 4
        if (pillX > W - 100) break
      }

      // ── Commit message ────────────────────────────────────────────────────
      const msgX = pillX + 4
      const maxMsgW = W - msgX - 200
      ctx.font = FONT
      ctx.fillStyle = isSelected ? '#e6edf3' : node.commit.refs.length > 0 ? '#c9d1d9' : '#8b949e'
      const msg = truncateText(ctx, node.commit.message, maxMsgW)
      ctx.fillText(msg, msgX, cy + 4.5)

      // ── Author ────────────────────────────────────────────────────────────
      ctx.font = `12px 'Inter', system-ui`
      ctx.fillStyle = '#58677a'
      const authorText = node.commit.author
      ctx.fillText(truncateText(ctx, authorText, 120), W - 290, cy + 4.5)

      // ── Date ─────────────────────────────────────────────────────────────
      const date = formatRelativeDate(node.commit.date)
      ctx.font = `11px 'Inter', system-ui`
      ctx.fillStyle = '#58677a'
      ctx.fillText(date, W - 155, cy + 4.5)

      // ── SHA ───────────────────────────────────────────────────────────────
      ctx.font = FONT_MONO
      ctx.fillStyle = '#3d5269'
      ctx.fillText(node.commit.shortSha, W - 68, cy + 4.5)
    }
  }, [scrollTop, selectedSha, getVisibleRange, maxLane])

  // Rebuild layout when commits change
  useEffect(() => {
    nodesRef.current = buildGraphLayout(commits)
  }, [commits])

  // Redraw whenever scroll/selection/commits change
  useEffect(() => {
    draw()
  }, [draw, commits, scrollTop, selectedSha])

  // Handle resizes
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = container.clientWidth
      canvas.height = container.clientHeight
      draw()
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [draw])

  // Click detection
  const getRowFromEvent = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      const clickY = e.clientY - rect.top + scrollTop
      const row = Math.floor(clickY / ROW_H)
      return nodesRef.current[row] ?? null
    },
    [scrollTop]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const node = getRowFromEvent(e)
      if (node) onSelectCommit(node.commit.sha)
    },
    [getRowFromEvent, onSelectCommit]
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const node = getRowFromEvent(e)
      if (node && onContextMenu) onContextMenu(e, node.commit.sha)
    },
    [getRowFromEvent, onContextMenu]
  )

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <canvas ref={canvasRef} onClick={handleClick} onContextMenu={handleContextMenu} style={{ display: 'block', cursor: 'default' }} />
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 0) return ''
  if (ctx.measureText(text).width <= maxW) return text
  let lo = 0, hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + '…'
}

function formatRelativeDate(isoDate: string): string {
  if (!isoDate) return ''
  const d = new Date(isoDate)
  const diff = Date.now() - d.getTime()
  const seconds = diff / 1000
  if (seconds < 60) return 'just now'
  const minutes = seconds / 60
  if (minutes < 60) return `${Math.floor(minutes)}m ago`
  const hours = minutes / 60
  if (hours < 24) return `${Math.floor(hours)}h ago`
  const days = hours / 24
  if (days < 30) return `${Math.floor(days)}d ago`
  const months = days / 30
  if (months < 12) return `${Math.floor(months)}mo ago`
  return `${Math.floor(months / 12)}y ago`
}
