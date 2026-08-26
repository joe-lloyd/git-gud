import React from 'react'

// ── Central icon registry ─────────────────────────────────────────────────────
// Every icon in the app renders through <Icon name="…" /> from this table.
// Rules (see docs/design/icons.md for the full reference):
//   • 24×24 viewBox, stroke: currentColor, strokeWidth 2, round caps/joins.
//   • Icons inherit text color — tint by setting `color` on the parent (or via
//     the `className` prop), never by hardcoding stroke colors here.
//   • One name per *meaning*, not per shape: use `arrow-up` for any upward
//     transfer (push, unstage), `x` for any dismiss/close.
//   • New icon? Add the entry here AND a row to docs/design/icons.md.
// Never inline raw emoji or unicode glyphs (🗑 ⎇ ↑ …) as UI icons.

type IconDef = {
  paths: React.ReactNode
  /** Solid glyph (e.g. brand marks) — rendered with fill instead of stroke. */
  fill?: boolean
}

const defs = {
  // ── Git objects & operations ──────────────────────────────────────────
  'branch': {
    paths: <>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>,
  },
  'commit': {
    paths: <>
      <circle cx="12" cy="12" r="4" />
      <line x1="2" y1="12" x2="8" y2="12" />
      <line x1="16" y1="12" x2="22" y2="12" />
    </>,
  },
  'merge': {
    paths: <>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </>,
  },
  'rebase': {
    paths: <>
      <circle cx="6" cy="5" r="3" />
      <path d="M6 8v5a4 4 0 0 0 4 4h5" />
      <polyline points="12 13 16 17 12 21" />
    </>,
  },
  'cherry-pick': {
    paths: <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </>,
  },
  'revert': {
    paths: <>
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </>,
  },
  'squash': {
    paths: <>
      <polyline points="8 4 12 8 16 4" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <polyline points="8 20 12 16 16 20" />
    </>,
  },
  'reset': {
    paths: <>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </>,
  },
  'tag': {
    paths: <>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </>,
  },
  'stash': {
    paths: <>
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </>,
  },
  'stash-apply': {
    paths: <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>,
  },
  'stash-pop': {
    paths: <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </>,
  },
  'fetch': {
    paths: <>
      <line x1="7" y1="4" x2="7" y2="20" />
      <polyline points="3 16 7 20 11 16" />
      <line x1="17" y1="20" x2="17" y2="4" />
      <polyline points="13 8 17 4 21 8" />
    </>,
  },
  'bisect': {
    paths: <>
      <circle cx="12" cy="12" r="9" />
      <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
    </>,
  },
  'history': {
    paths: <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 13.5" />
    </>,
  },
  'worktree': {
    paths: <>
      <path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z" />
      <path d="M12 22v-3" />
    </>,
  },
  'file-diff': {
    paths: <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="11" x2="12" y2="15" />
      <line x1="10" y1="13" x2="14" y2="13" />
      <line x1="10" y1="18" x2="14" y2="18" />
    </>,
  },
  'clean': {
    paths: <>
      <path d="M12 4l1.7 6.3L20 12l-6.3 1.7L12 20l-1.7-6.3L4 12l6.3-1.7z" />
      <path d="M19 3v4" />
      <path d="M17 5h4" />
    </>,
  },
  'cloud': {
    paths: <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />,
  },

  // ── Actions ───────────────────────────────────────────────────────────
  'copy': {
    paths: <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>,
  },
  'trash': {
    paths: <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </>,
  },
  'edit': {
    paths: <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />,
  },
  'search': {
    paths: <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>,
  },
  'refresh': {
    paths: <>
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </>,
  },
  'update': {
    paths: <>
      <path d="M12 3v10" />
      <path d="M8 9l4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>,
  },
  'download': {
    paths: <>
      <line x1="12" y1="4" x2="12" y2="15" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="5" y1="20" x2="19" y2="20" />
    </>,
  },
  'folder': {
    paths: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  },
  'plus': {
    paths: <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>,
  },
  'minus': {
    paths: <line x1="5" y1="12" x2="19" y2="12" />,
  },

  // ── Status & feedback ─────────────────────────────────────────────────
  'check': {
    paths: <polyline points="20 6 9 17 4 12" />,
  },
  'x': {
    paths: <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>,
  },
  'check-circle': {
    paths: <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="8 12 11 15 16 9" />
    </>,
  },
  'x-circle': {
    paths: <>
      <circle cx="12" cy="12" r="9" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </>,
  },
  'warning': {
    paths: <>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>,
  },
  'info': {
    paths: <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </>,
  },
  'question': {
    paths: <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>,
  },

  // ── Navigation & structure ────────────────────────────────────────────
  'arrow-up': {
    paths: <>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </>,
  },
  'arrow-down': {
    paths: <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </>,
  },
  'arrow-left': {
    paths: <>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </>,
  },
  'arrow-right': {
    paths: <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </>,
  },
  'chevron-down': {
    paths: <polyline points="6 9 12 15 18 9" />,
  },
  'chevron-right': {
    paths: <polyline points="9 6 15 12 9 18" />,
  },
  'corner-down-right': {
    paths: <>
      <polyline points="15 10 20 15 15 20" />
      <path d="M4 4v7a4 4 0 0 0 4 4h12" />
    </>,
  },
  'dot-circle': {
    paths: <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
    </>,
  },
  'circle': {
    paths: <circle cx="12" cy="12" r="5" />,
  },
  'home': {
    paths: <>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </>,
  },

  // ── App chrome ────────────────────────────────────────────────────────
  'terminal': {
    paths: <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </>,
  },
  // Another Git Gud instance (peer machine): two linked nodes.
  'peer': {
    paths: <>
      <rect x="2" y="4" width="8" height="6" rx="1.5" />
      <rect x="14" y="14" width="8" height="6" rx="1.5" />
      <path d="M10 7h3a3 3 0 0 1 3 3v4" />
      <path d="M14 17h-3a3 3 0 0 1-3-3v-4" />
    </>,
  },
  'settings': {
    paths: <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>,
  },
  'github': {
    fill: true,
    paths: <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23a11.4 11.4 0 0 1 3-.405c1.02 0 2.04.135 3 .405 2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />,
  },
} satisfies Record<string, IconDef>

export type IconName = keyof typeof defs

/** All registered icon names — used by the design-system reference. */
export const ICON_NAMES = Object.keys(defs) as IconName[]

export interface IconProps {
  name: IconName
  /** Rendered width/height in px. Default 16. */
  size?: number
  className?: string
  /** Accessible label. Omit for decorative icons (hidden from AT). */
  title?: string
  style?: React.CSSProperties
}

export const Icon: React.FC<IconProps> = ({ name, size = 16, className, title, style }) => {
  const def: IconDef = defs[name]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={def.fill ? 'currentColor' : 'none'}
      stroke={def.fill ? 'none' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `gg-icon ${className}` : 'gg-icon'}
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {def.paths}
    </svg>
  )
}
