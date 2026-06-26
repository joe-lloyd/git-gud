## 1. Foundation — feature catalog

- [x] 1.1 Create `docs/git-features.md` with sections: History, Staging, Branching, Remote, Recovery, Advanced
- [x] 1.2 Fill in every currently-supported feature with status "supported" (commit, push, pull, fetch, stage, unstage, applyPatch hunk/line, stash save/pop/apply/drop, branch CRUD, tag CRUD, worktree CRUD, bisect, rebase, cherry-pick, merge, checkout, reset, format-patch)
- [x] 1.3 Add the 8 planned features as "planned" with a one-line description and a link to this change directory
- [x] 1.4 Add the explicit "not planned (yet)" list: LFS, submodules, sparse-checkout, partial clone
- [x] 1.5 Cross-link from README.md (or create one) to the catalog

## 2. commit-amend — highest ROI, lowest risk

- [x] 2.1 Add `amendCommit(message: string)` to `git-service.ts` → `git commit --amend -m <message>`
- [x] 2.2 Add IPC handler `git:commit-amend` in `main/index.ts`
- [x] 2.3 Expose `commitAmend(message: string)` in preload `index.ts`
- [x] 2.4 Add "Amend last commit" checkbox above the commit textarea in `WorkingTree.tsx`
- [x] 2.5 On toggle ON: fetch last commit message via `getLog(1)` and pre-fill textarea; change button label to "Amend on <branch>"
- [x] 2.6 On toggle OFF: restore previous textarea content
- [x] 2.7 Add yellow warning under the checkbox when `status.ahead === 0` (commit has been pushed)
- [x] 2.8 Wire Ctrl/Cmd+Enter in textarea to submit
- [x] 2.9 Update `docs/git-features.md`: commit-amend → "supported"

## 3. word-diff — visual polish, isolated to DiffViewer

- [x] 3.1 Extend `getFileDiff` and `getCommitFileDiff` in `git-service.ts` to accept a `wordDiff?: boolean` option that adds `--word-diff=porcelain` to the underlying call
- [x] 3.2 Update IPC handlers + preload signatures
- [x] 3.3 Add a "Word diff" toggle button to the DiffViewer header in `DiffViewer.tsx`
- [x] 3.4 Write a parser for porcelain word-diff output (lines starting with `+`, `-`, ` `, `~`); accumulate inline tokens
- [x] 3.5 Render parsed output with `<ins>` / `<del>` spans styled green/red inline
- [x] 3.6 Hide stage/discard chunk and per-line buttons while word-diff mode is on
- [x] 3.7 Fall back to line diff + toast on parse failure
- [x] 3.8 Update `docs/git-features.md`: word-diff → "supported"

## 4. pickaxe-search — mode toggle on existing SearchBar

- [x] 4.1 Add `logPickaxe(query: string, limit: number)` to `git-service.ts` → `git log -S <query> --all --format=...`
- [x] 4.2 Add IPC handler `git:log-pickaxe` + preload signature
- [x] 4.3 Add mode toggle (Message / Content) to `SearchBar.tsx` UI
- [x] 4.4 In Content mode, debounce input and call `logPickaxe(query, 200)`
- [x] 4.5 Render pickaxe results with the same row template as message search
- [x] 4.6 Show "Type to search commit contents" when query empty
- [x] 4.7 Show "200 results — refine your query for more." footer when cap hit
- [x] 4.8 Update `docs/git-features.md`: pickaxe-search → "supported"

## 5. stash-branch — simple addition to stash context menu

- [x] 5.1 Add `stashBranch(name: string, index: number)` to `git-service.ts` → `git stash branch <name> stash@{<index>}`
- [x] 5.2 Add IPC handler `git:stash-branch` + preload signature
- [x] 5.3 Add "Create branch from stash…" entry to the stash context menu in `App.tsx`
- [x] 5.4 Wire the existing InputModal with title "Create Branch from stash@{N}" and subtitle "Applies the stash and removes it from the list"
- [x] 5.5 On success: refresh repo state; toast success
- [x] 5.6 On error: surface git error in toast
- [x] 5.7 Update `docs/git-features.md`: stash-branch → "supported"

## 6. interactive-add — keyboard polish for existing engine

- [x] 6.1 Add a `focusedHunk` state to DiffViewer plus refs per hunk header
- [x] 6.2 Implement onKeyDown handler on the DiffViewer container: `j/k`, `ArrowUp/Down` move focus
- [x] 6.3 `s` stages the focused hunk (reuses existing handleStageChunk)
- [x] 6.4 `Shift+S` stages all hunks in the file
- [x] 6.5 `d` arms discard on focused hunk; second `d` within 3s confirms (reuses existing two-step state)
- [x] 6.6 `Shift+D` arms discard for all hunks; second press confirms
- [x] 6.7 Alt+click on +/− sign discards that single line
- [x] 6.8 Add a "?" button toggling a shortcut-overlay panel inside DiffViewer
- [x] 6.9 Apply global `:focus-visible` ring to focused hunk header (already global, just ensure it shows)
- [x] 6.10 Update `docs/git-features.md`: interactive-add → "supported"

## 7. reflog-recovery — new right-panel

- [x] 7.1 Add `getReflog(limit: number)` to `git-service.ts` → `git reflog --format=%h|%gs|%gd|%aI` parsed into structured entries
- [x] 7.2 Add `restoreFromReflog(sha: string)` running `git reset --hard <sha>`
- [x] 7.3 IPC handlers + preload signatures for both
- [x] 7.4 Create `src/renderer/components/Reflog/ReflogPanel.tsx` rendering entries newest-first
- [x] 7.5 Each row: short SHA, action, message, relative date
- [x] 7.6 Add "Restore HEAD here" button per row → opens ConfirmModal with "This will discard any commits made after this point" copy
- [x] 7.7 Add "Copy SHA" button per row (clipboard + toast)
- [x] 7.8 Add Toolbar button "Reflog" that toggles the panel into the right column
- [x] 7.9 In App.tsx, extend the right-panel switch: show Reflog when `showReflog === true`, take priority over WorkingTree/CommitDetail/Bisect
- [x] 7.10 Implement keyboard nav in ReflogPanel: arrows move focus, Enter opens restore confirm, `c` copies SHA
- [x] 7.11 Update `docs/git-features.md`: reflog-recovery → "supported"

## 8. clean-untracked — destructive, deserves care

- [x] 8.1 Add `cleanPreview(opts: { dirs: boolean; ignored: boolean })` to `git-service.ts` → `git clean -n` with appropriate flags, returns string[]
- [x] 8.2 Add `clean(paths: string[])` running `git clean -f -- <paths>` (paths-only, no flags — uncheck-aware)
- [x] 8.3 IPC handlers + preload signatures
- [x] 8.4 Create `src/renderer/components/Clean/CleanModal.tsx`
- [x] 8.5 On open + on scope-toggle change, call `cleanPreview` and render list with per-row checkboxes (default all checked)
- [x] 8.6 Three scope toggles: Untracked files (default on), Untracked directories (default on, adds `-d`), Ignored files (default off, adds `-x`)
- [x] 8.7 Confirmation input field — Confirm button disabled until user types `delete` (case-insensitive)
- [x] 8.8 On confirm: run `clean(checkedPaths)`; toast `Cleaned N files.`
- [x] 8.9 Add "Clean…" button to Advanced bar; open modal on click
- [x] 8.10 Update `docs/git-features.md`: clean-untracked → "supported"

## 9. rerere-recording — settings infrastructure

- [x] 9.1 Add `getConfig(key: string)` and `setConfig(key: string, value: string)` to `git-service.ts` (uses `git config`)
- [x] 9.2 Add `rerereForget(path: string)` running `git rerere forget <path>`
- [x] 9.3 IPC handlers + preload signatures
- [x] 9.4 Create `src/renderer/components/Settings/SettingsModal.tsx` (skeleton supports future settings)
- [x] 9.5 First setting: "Reuse recorded merge conflict resolutions (rerere)" toggle, reflecting `rerere.enabled`
- [x] 9.6 Add gear icon to Toolbar that opens SettingsModal
- [x] 9.7 During merge: detect rerere-applied files (check `.git/rr-cache` presence after the merge) — surface as a banner in WorkingTree
- [x] 9.8 Banner has "Forget this resolution" button calling `rerereForget`
- [x] 9.9 Update `docs/git-features.md`: rerere-recording → "supported"

## 10. Wrap-up

- [ ] 10.1 Verify keyboard nav works end-to-end across all new components (`Tab`, `Esc`, arrows)
- [ ] 10.2 Verify focus-visible ring shows on all interactive elements introduced
- [ ] 10.3 Smoke-test each feature against the throwaway repos built by `scripts/build-test-repos.sh`
- [ ] 10.4 Audit `docs/git-features.md` for completeness — every feature in `git-service.ts` listed
- [x] 10.5 Run `pnpm typecheck` and resolve any errors
