# Git Gud Design System

The fundamentals every screen is built from. Tokens live in
`src/renderer/styles/global.css` (`:root`); icons live in
`src/renderer/components/Icons/Icon.tsx` (see [icons.md](./icons.md) for the
full lookup table). If a component needs a color, size, or icon, it comes from
here — not from a hardcoded value.

## Color

Dark, rich, GitKraken-inspired. Neon hot pink is the single brand accent.

### Surfaces

| Token | Value | Use |
|---|---|---|
| `--bg-deepest` | `#0d1117` | App background, inputs |
| `--bg-base` | `#13181f` | Toolbar, sidebar, main panels |
| `--bg-elevated` | `#1a2030` | Cards, modals, popovers, tooltips |
| `--bg-panel` | `#1e2638` | Context menus, dropdowns |
| `--bg-hover` | `#2a3347` | Hover state on rows/buttons |
| `--bg-active` | `#2e3d57` | Pressed / active-selection state |

### Accent (brand)

| Token | Value | Use |
|---|---|---|
| `--accent` | `#ff4fc3` | Primary buttons, selection, links, HEAD lane |
| `--accent-bright` | `#ff2d95` | Emphasis moments only |
| `--accent-hover` | `#ff79d6` | Hover on accent fills |
| `--accent-subtle` | `rgba(255,79,195,.16)` | Selected-row washes, focus glow |
| `--accent-border` | `rgba(255,79,195,.45)` | Borders on accent elements |
| `--on-accent` | `#1a0f17` | Text on accent fills (dark for contrast) |

### Text

| Token | Value | Use |
|---|---|---|
| `--text-primary` | `#f0f4f8` | Headings, row labels, anything readable-first |
| `--text-secondary` | `#aab4bf` | Supporting copy, inactive buttons |
| `--text-muted` | `#7c8a9a` | Hints, timestamps, counts |

High-contrast mode (`:root[data-contrast="high"]`, toggled in Settings)
brightens all three plus `--border` — never bypass the tokens or the mode
stops working.

### Semantic

| Token | Value | Use |
|---|---|---|
| `--success` | `#68d391` | Success toasts, "good" bisect marks, additions |
| `--danger` | `#fc8181` | Destructive actions, failures, deletions |
| `--warning` | `#f6ad55` | Force-push warnings, amend-after-push notice |
| `--info` | `#ff4fc3` | Informational toasts (matches accent) |

Destructive menu items and buttons always pair `--danger` color **with** a
confirm step (in-app `ConfirmModal`, never `window.confirm`).

### Graph lanes

`--lane-0` … `--lane-9`. Lane 0 is the brand pink and doubles as HEAD's lane;
the rest alternate warm/cool so adjacent lanes stay distinct. File-status
colors reuse lane hues: modified amber `#f6ad55`, added green `#68d391`,
deleted coral `#fc8181`, renamed purple `#b794f4`, copied cyan `#76e4f7`.

## Typography

| Role | Face | Size |
|---|---|---|
| UI default | `Inter, system-ui, sans-serif` | 13px base, `line-height: 1.5` |
| Code / SHAs / paths | `.mono` → `JetBrains Mono, Fira Code, monospace` | inherits |
| Section labels | Inter 600–700 | 10–11px, uppercase, letter-spaced |
| Panel headings | Inter 600–700 | 15–18px |

Keyboard keys render as `<kbd>` with the literal key glyph (`⌘`, `⇧`, `↑`) —
these are *typography*, not icons, and stay as text. Same for the `+`/`−`
signs in diff gutters and stat counts, and arrows inside label strings
("Reset → Soft").

## Spacing & sizing

| Token | Value |
|---|---|
| `--toolbar-height` | 48px |
| `--sidebar-width` | 240px default (drag-resizable 180–600) |
| `--detail-width` | 340px |
| `--commit-row-height` | 36px |
| `--graph-lane-width` | 16px |

Radii: 4px (menu items), 6px (buttons, inputs), 8px (menus, tooltips),
10–12px (modals). Gaps inside rows/buttons: 6–8px.

## Components

- **Buttons** — `.btn` + `.btn-primary` (accent fill), `.btn-ghost` (subtle
  outline), `.btn-danger` (danger wash). Icon-only toolbar buttons use
  `.tb-icon-btn` with a 16px icon and a `title` tooltip.
- **Ref pills** — `.ref-pill` + `.ref-local` (pink), `.ref-remote` (green),
  `.ref-tag` (amber), `.ref-head` (rose). Pills carry 10px icons from the
  icon set (`branch`, `cloud`, `tag`, `dot-circle`, `worktree`).
- **Modals** — `.modal-overlay` (fixed, dimmed) + elevated panel. Confirm
  modals lead with a 30px `warning`/`info`/`question` icon.
- **Toasts** — type-colored icon (`check-circle`, `x-circle`, `warning`,
  `info`) + title + optional pre-formatted message.
- **Context menus** — `.cm-menu`; every item may carry a 14px icon in a fixed
  16px slot so labels align. Menus are *contextual*: entries that don't apply
  to the current repo state are disabled (self-merge) or omitted entirely
  (bisect marks outside a bisect session).

## Motion

`fadeIn` 0.12–0.2s ease for popovers/menus/modals; `spin` 0.7s linear for
in-flight operations (fetch/pull/push buttons, loading states). Nothing else
animates — the graph should feel instant.

## Focus & accessibility

`:focus-visible` shows a 1.5px accent ring (keyboard only; mouse clicks don't
ring). Persistent selection is a background (`.selected`), never a ring.
Decorative icons are `aria-hidden`; icons that carry meaning get a `title`.
