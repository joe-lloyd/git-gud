# Icon Reference

Every icon in Git Gud renders through the central registry in
`src/renderer/components/Icons/Icon.tsx`:

```tsx
import { Icon } from '../Icons/Icon'

<Icon name="branch" size={14} />                 // decorative (aria-hidden)
<Icon name="warning" size={14} title="Warning" />  // meaningful (labelled)
```

**Rules**

- Never inline emoji (🗑 📁 🧹) or unicode glyphs (⎇ ↑ ⊕) as UI icons — add a
  registry entry instead.
- Icons are 24×24 stroke drawings (`strokeWidth 2`, round caps) drawn with
  `currentColor` — tint by setting `color` on the parent, never inside the
  registry.
- One name per **meaning**, not per shape. Pick from this table before adding
  a new icon; if you add one, add its row here too.
- `ContextMenuAction.icon`, `SidebarItem.icon`, and Toast icons are typed as
  `IconName`, so a typo is a compile error.

**Sizes**: 10px (ref pills, tags), 11–12px (inline with 11–12px text, row
actions), 13–14px (context menus, panel buttons), 16px (toolbar), 30px+
(modal/empty-state headline icons).

**What stays text** (not icons): `<kbd>` key glyphs (`⌘` `⇧` `↑`), diff
`+`/`−` signs, arrows inside label strings ("Reset → Soft"), terminal output
marks in the console log (`↳`, `$`), and the graph's `◆` stash badge.

## Git objects & operations

| Name | Looks like | Meaning / use |
|---|---|---|
| `branch` | git branch fork | Branches anywhere: create, checkout, branch-from-X, toolbar Branch, repo header |
| `commit` | dot on a line | A single commit; checkout detached HEAD |
| `merge` | lanes joining | Any merge action (both directions, drag-merge) |
| `rebase` | lane curving onto another | Rebase actions (plain and interactive) |
| `cherry-pick` | ⊕ plus in circle | Cherry-pick (single and bulk) |
| `revert` | corner-up-left arrow | Revert commit(s) |
| `squash` | arrows collapsing to a line | Squash commits into one |
| `reset` | counter-clockwise arrow | `git reset` (soft/mixed/hard) |
| `tag` | luggage tag | Tags: create, sidebar rows, ref pills |
| `stash` | archive box | Stash entity: toolbar Stash, sidebar stash rows |
| `stash-apply` | arrow down into tray | Apply stash (keeps it) |
| `stash-pop` | arrow up out of tray | Pop stash (applies + removes); toolbar Pop |
| `fetch` | down + up arrows | Fetch all remotes |
| `bisect` | circle with slash | Bisect panel / advanced-bar button |
| `history` | clock | Reflog / history recovery |
| `worktree` | 2×2 grid | Worktrees: rows, manage, ref-pill marker |
| `file-diff` | file with +/− | Patch (export/apply), "Export patch…" |
| `clean` | sparkle | Clean untracked/ignored files |
| `cloud` | cloud | Remotes: sidebar remote group, remote-branch pill marker |

## Actions

| Name | Looks like | Meaning / use |
|---|---|---|
| `copy` | two rectangles | Copy anything to clipboard (names, SHAs, paths, log) |
| `trash` | trash can | Delete/drop: branches, tags, stashes, worktrees, commits |
| `edit` | pencil | Rename branch, edit author, modified-file status |
| `search` | magnifier | Commit search |
| `refresh` | two circular arrows | Refresh repo state; loading spinners (with `.spin`) |
| `update` | arrow into tray | Check for app updates |
| `download` | arrow down to line | Clone repository |
| `folder` | folder | Open local repository |
| `plus` | + | Add; added-file status |
| `minus` | − | Remove; deleted-file status |

## Status & feedback

| Name | Looks like | Meaning / use |
|---|---|---|
| `check` | checkmark | Success inline: current branch, bisect "good", console ok |
| `x` | × | Close/dismiss any panel; discard; bisect "bad"; console failed |
| `check-circle` | check in circle | Success toast, bisect Good menu item, bisect done |
| `x-circle` | × in circle | Error toast, bisect Bad menu item |
| `warning` | triangle ! | Force-push, amend-after-push, conflicts, danger confirms |
| `info` | i in circle | Info toast, non-danger confirm modal |
| `question` | ? in circle | Choice modal, unknown file status |

## Navigation & structure

| Name | Looks like | Meaning / use |
|---|---|---|
| `arrow-up` | ↑ | Upward transfer: push, unstage |
| `arrow-down` | ↓ | Downward transfer: pull, stage |
| `arrow-left` | ← | Back / take-current (conflict editor) |
| `arrow-right` | → | Forward / take-incoming / switch-to / renamed-file status |
| `chevron-down` | ˅ | Dropdown affordance (push options caret) |
| `chevron-right` | › | Collapsed/expandable group |
| `corner-down-right` | ↳ | Remote-tracking branch rows |
| `dot-circle` | ◉ | "You are here": current worktree, HEAD pill |
| `circle` | ○ | Plain branch row (not current) |
| `home` | house | Return to Welcome screen |

## App chrome

| Name | Looks like | Meaning / use |
|---|---|---|
| `terminal` | console window | Toggle bottom console dock |
| `settings` | gear | Settings modal |
| `github` | octocat (filled) | GitHub panel |

## Adding an icon

1. Draw it as 24×24 stroke paths (feather-style, `strokeWidth 2`, round caps).
2. Add the entry to `defs` in `Icon.tsx` under the matching section.
3. Add a row to the matching table above with a one-line "meaning / use".
4. If an existing icon already means the same thing, use it instead — one
   name per meaning.
