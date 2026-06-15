## Context

The app is an Electron/React Git client. Architecture is settled and well-suited to additive features:
- **Main process** (`src/main/git-service.ts`) wraps `simple-git` + `git raw` for everything that needs precise control. IPC handlers in `src/main/index.ts`.
- **Preload** (`src/preload/index.ts`) exposes a flat `window.gitApi.*` surface to the renderer.
- **Renderer** uses a left Sidebar → center graph/diff → right panel layout. The right panel currently swaps between WorkingTree, CommitDetail, and BisectWizard based on selection — this is the slot for new panels (Reflog).
- Existing destructive ops use two patterns: **two-step arm/confirm** for in-place toggles (just landed for discard-chunk and discard-line), and **ConfirmModal** for repo-level ops. Keep both.
- Keyboard nav was just introduced for WorkingTree (focusedIdx + ref-based focus). New features must follow the same pattern: every action reachable by keyboard, focus distinct from selection.
- The catalog of all Git features (`docs/git-features.md`) is documentation, not a runtime capability — it goes in tasks, not specs.

Current support reality (as of this change):
- **Supported**: commit, push, pull, fetch, stage, unstage, stash save/pop/apply/drop, branch create/rename/delete/checkout, tag create/delete, worktree add/remove/list, fetch with creds, remotes list/add, log, status, file diff, commit diff, applyPatch (stage/unstage/discard hunk and line), bisect start/good/bad/reset, rebase to commit, interactive rebase, cherry-pick, merge, reset hard, format-patch.
- **Missing**: see proposal — 8 new capabilities.

## Goals / Non-Goals

**Goals:**
- Add eight self-contained features without disrupting current flows.
- Keep destructive ops behind explicit confirm (no accidental data loss).
- Every new control is keyboard-reachable and respects the global focus-visible ring.
- Make `docs/git-features.md` the single source of truth for "what does this app do with Git" — updated as each capability lands.
- Reuse existing patterns: right-panel swap, ConfirmModal, applyPatch, IPC handler shape.

**Non-Goals:**
- No new dependencies — keep using `simple-git` + `git raw`. (Org policy.)
- No GUI for low-level porcelain commands users would never invoke (e.g., `git update-ref`, `git symbolic-ref` — internal use only).
- No Git-LFS, submodules, or sparse-checkout support in this change. Out of scope; can be follow-ups.
- No major architectural changes. New features plug into existing slots.

## Decisions

### 1. Reflog gets its own right-panel, not a modal
**Decision**: Reflog browser swaps into the right panel (same slot as Bisect/CommitDetail/WorkingTree), driven by either a sidebar entry ("Reflog") or a toolbar button.

**Why**: Reflog use is exploratory — you scroll, you click an entry, you see what HEAD was. A modal blocks the graph you're trying to compare against; the right-panel doesn't. The Bisect refactor we just did proves the pattern works for panels with their own internal state.

**Alternative considered**: Full-screen overlay (rejected — same drawback as Bisect modal had). Sidebar list of entries (rejected — entries are dense and need richer per-entry detail).

### 2. Amend lives in the WorkingTree commit box
**Decision**: Add an "Amend last commit" checkbox above the commit message textarea in WorkingTree. When checked, the message field pre-fills with the last commit's message, the button label changes to "Amend on `<branch>`", and submission calls a new `commit:amend` IPC (which runs `git commit --amend --message <m>` with whatever's staged).

**Why**: Amend is a variant of commit, not a separate flow. Co-locating keeps it discoverable without a new screen. Pre-filling the message makes the most common use case (fix typo, keep changes) one keystroke.

**Guardrail**: Amending a commit that has been pushed is a footgun. We detect `ahead < 1` against upstream and, in that case, show a yellow warning under the checkbox: "This commit has been pushed — amending will require force-push." We don't block (users may legitimately want this), but we surface it.

**Alternative considered**: Dedicated "Amend" right-click on a commit (rejected for HEAD — overlaps with `commit:amend` semantics; only HEAD can be cleanly amended; the right-click would then need to disable itself for non-HEAD which is confusing).

### 3. Word-diff is a renderer-side parse of `--word-diff=porcelain`
**Decision**: Add a toggle "Word diff" button in the DiffViewer header. When on, re-fetch the diff with `--word-diff=porcelain` and render tokens with `<ins>`/`<del>` spans.

**Why**: `--word-diff=porcelain` emits per-token markers (`{+added+}`, `[-removed-]` style internally but porcelain is machine-friendly: each line starts with `+`, `-`, ` `, or `~`). Renderer parses, no main-process change beyond passing the flag.

**Alternative considered**: Always show word diff (rejected — line diff is faster to scan for code; only natural-language/config files benefit from word diff). User-toggle is the right granularity.

### 4. Pickaxe slots into the existing SearchBar
**Decision**: Add a mode toggle to SearchBar — "Message" (current) vs "Content" (new). Content mode calls a new `log:pickaxe` IPC running `git log -S "<query>" --all --format=...` and surfaces matching commits. Hitting Enter on a result selects the commit in the graph (existing behavior).

**Why**: One search bar, two scopes. Avoids a second UI. Pickaxe results have the same shape as message search.

**Alternative considered**: Separate "Content search" command (rejected — duplicates UI). `--pickaxe-regex` extension can be a follow-up; for now, fixed-string search is what `-S` does and matches user expectation.

### 5. Stash branch is a stash context-menu entry
**Decision**: Add "Create branch from stash…" to the stash right-click menu. Opens the existing InputModal asking for a branch name. Submission calls a new `stash:branch` IPC running `git stash branch <name> stash@{<index>}`.

**Why**: Stash actions live in their context menu (apply/pop/drop). One more entry, consistent.

**Guardrail**: This implicitly applies the stash and drops it from the stash list. We show that in the modal subtitle ("Applies the stash and removes it from the list").

### 6. Clean is a ConfirmModal with a preview list
**Decision**: Add a "Clean untracked files…" button to the Advanced bar (next to Bisect/Patch). Opens a new CleanModal that:
1. Runs `git clean -fdx --dry-run` to preview what would be deleted.
2. Shows the list with checkboxes per file (default all checked).
3. Provides three scope toggles: untracked files / untracked directories / ignored files.
4. Confirm button only enables after the user types "delete" (extreme version of two-step arm) — because this can nuke `node_modules` and uncommitted untracked work.

**Why**: `git clean -fdx` is the single most destructive Git op a developer can run by accident. The preview + typed-confirm pattern is borrowed from GitHub's "type the repo name to delete" — proven to prevent thinkos.

**Alternative considered**: Two-step arm/confirm button (rejected — not enough friction for this op).

### 7. Reflog restoration uses a hard reset + warning
**Decision**: In the ReflogPanel, each entry has a "Restore HEAD here" action. Clicking it shows a ConfirmModal: "Reset HEAD to <sha>. This will discard any commits made after this point. Continue?" Confirm calls a new `reflog:restore` IPC running `git reset --hard <sha>`.

**Why**: Reflog is the recovery tool; users coming to it usually want to undo a bad reset. `git reset --hard` is the only operation that gets you exactly back. We surface the loss of "newer" commits clearly.

**Guardrail**: Always offer "Copy SHA" as the soft option — sometimes users just want to look without resetting.

### 8. Rerere is a settings toggle, not a feature surface
**Decision**: Add a Settings panel (one new modal opened from a gear icon in the Toolbar). First setting: "Reuse merge conflict resolutions (`rerere.enabled`)". When toggled, runs `git config rerere.enabled true|false` for the repo. During merge conflicts, surface a small indicator if rerere applied a recorded resolution.

**Why**: Rerere is a behavioral setting most users will never enable but power users will want. A settings panel also unlocks a place for future toggles (e.g., default editor, GPG signing) without re-architecting.

**Alternative considered**: Auto-enable rerere on first merge conflict (rejected — silent behavioral change).

### 9. Interactive-add polish keeps the existing engine
**Decision**: Keep `applyPatch` + per-hunk/per-line stage. Add keyboard shortcuts inside DiffViewer:
- `j/k` or `↑/↓` move focus between hunks
- `s` stage the focused hunk
- `S` stage all hunks
- `d` discard the focused hunk (arms, then confirms)
- `D` discard all hunks
- `Esc` close

**Why**: The mechanics are right; the UX needs keyboard hooks to feel like `git add -p` rather than only a click target. No new IPC.

**Alternative considered**: A modal "interactive add" wizard mimicking the CLI (rejected — DiffViewer is already a great interactive-add UI; the only gap is keyboard).

## Risks / Trade-offs

- **Amend on pushed commits causes force-push surprise** → Mitigation: warn in the UI when ahead-of-upstream is 0; never block (org policy: respect user judgment).
- **Reflog reset is destructive and easy to misclick** → Mitigation: ConfirmModal with explicit "this discards N commits" copy; Copy SHA as the safe alternative.
- **Clean -fdx can wipe `node_modules` (intended) but also genuinely-untracked work (unintended)** → Mitigation: dry-run preview + typed "delete" confirm + per-file checkboxes (let users uncheck things they want to keep).
- **Pickaxe on large repos is slow** → Mitigation: scope to `--all` but only fetch first 200 results; show "load more" if hit.
- **Word-diff porcelain format may have edge cases (newlines, ANSI)** → Mitigation: fall back to standard line diff if parse fails; show a small "Word diff parse error — showing line diff" toast.
- **Rerere can apply a wrong resolution silently if a stale recording matches** → Mitigation: when rerere applies, show a banner with "Rerere applied a recorded resolution — review carefully" and a "Forget this resolution" button (`git rerere forget`).
- **Catalog drift** → docs/git-features.md will get stale as features ship. Mitigation: task in each feature's implementation requires updating the matrix before merge.

## Migration Plan

This change is additive — no migration. Each capability is independently shippable:

1. Ship in tasks.md order (amend → word-diff → pickaxe → stash-branch first; reflog → clean → rerere → interactive-add polish last).
2. Each capability gates on (a) its IPC working, (b) keyboard nav, (c) catalog updated.
3. No DB migrations, no settings file changes beyond `git config` (which is per-repo and reversible).

Rollback per capability: revert the commit. No data loss because none of these write app-state.

## Open Questions

- Should the catalog (`docs/git-features.md`) live under `openspec/` (where it can be a living spec artifact) or under `docs/` (where it's discoverable to users browsing the repo)? **Proposed**: `docs/git-features.md` for discoverability; openspec change docs reference it.
- Rerere indicator placement during conflicts — toolbar banner vs inline in WorkingTree conflicts section? **Defer to implementation** when we tackle that feature.
- Clean modal: do we want a "since X" filter (e.g., "only files older than 1 day")? **No, scope creep.** Per-file uncheck handles selective clean.
- Reflog entry detail: do we show the diff each ref-move introduced (heavy) or just the action label ("commit", "reset", "checkout")? **Start with label-only; diff can be a follow-up.**
