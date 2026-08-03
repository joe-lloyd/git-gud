# Tasks: add-gerrit-mode

## 1. Types & plumbing

- [x] 1.1 Add Gerrit types to `src/preload/index.ts` (canonical home): `GerritDetection`, `GerritModeConfig`, `GerritChange`, `PushForReviewOptions`, `CommitTrailer`; extend `CommitNode` with `changeId?: string`
- [x] 1.2 Extend `GitService.getLog` format with a `%(trailers:key=Change-Id,valueonly,separator=)` field and parse it in `parseRawLog` into `CommitNode.changeId` (empty → undefined); mirror type in `git-service.ts`
- [x] 1.3 Unit test: `parseRawLog` extracts Change-Id and leaves commits without trailers unchanged

## 2. Detection (main)

- [x] 2.1 Create `src/main/gerrit-service.ts` with `detectGerrit(repoPath, remotes)`: `.gitreview` parse (host/port/project/defaultbranch), remote URL heuristics (port 29418, `gerrit` in host/path, `/a/` prefix), `commit-msg` hook content check — pure helpers split into `gerrit-utils.ts` so tests run without electron
- [x] 2.2 Add `gerrit:detect` IPC handler in `src/main/index.ts` + `gerritApi.detect` in preload
- [x] 2.3 Unit tests for detection heuristics (gitreview parsing, URL variants, negative cases)

## 3. Mode flag & settings

- [x] 3.1 Renderer mode read/write via existing `git:config-get`/`git:config-set` (`gitgud.gerrit.enabled|host|project|branch`) inside a new `useGerrit` hook
- [x] 3.2 Suggestion banner component: shows when `detection.likely` and flag unset; Enable → opens confirm modal (host/project/branch editable, host may stay empty); Dismiss → writes `enabled=false`
- [x] 3.3 Gerrit section in `SettingsModal` (visible for the open repo): toggle mode, edit host/project/default branch, credential entry

## 4. Push for review

- [x] 4.1 `GitService.pushForReview(opts)` building `push <remote> HEAD:refs/for/<branch>[%topic=…,wip|ready|private]` with auth configs; classify `missing Change-Id` and `no new changes` stderr into typed errors
- [x] 4.2 IPC `gerrit:push-for-review` + preload method
- [x] 4.3 Review-push modal (target branch, topic, WIP/private) added to the `AppModal` union; toolbar primary button swaps to "Push for review" in Gerrit mode, plain/force push stay in caret menu which gains "Push for review…"
- [x] 4.4 Toast handling per rejection class in `useGerrit` actions; refresh + changes-list refresh on success
- [x] 4.5 Unit test: refspec/push-option string builder covers all option combinations

## 5. Gerrit REST client (main)

- [x] 5.1 `gerritFetch` in `gerrit-service.ts`: native fetch, `)]}'` strip, JSON error normalization, anonymous vs `/a/` + Basic auth switch
- [x] 5.2 Credential storage: per-host Gerrit `{username, password}` in a `safeStorage`-encrypted `gerrit-auth.json` (same pattern as provider-auth, separate file); `gerrit:set-auth`, `gerrit:clear-auth`, `gerrit:auth-status` IPC (renderer gets boolean only)
- [x] 5.3 `gerrit:list-changes` IPC → `GET /changes/?q=project:<p>+status:open&o=CURRENT_REVISION&o=DETAILED_ACCOUNTS`, mapped to `GerritChange[]`
- [x] 5.4 Unit tests: XSSI strip, project-name derivation from remote URLs, auth path prefixing

## 6. Changes panel (renderer)

- [x] 6.1 `GerritPanel` component: list rows (`#number subject owner PS<n> [WIP]`), loading/error/setup-hint states, manual refresh
- [x] 6.2 Wire into layout behind `mode.enabled` — right-panel view (ReflogPanel pattern) toggled by a "Changes" button in the advanced bar, visible only in Gerrit mode
- [x] 6.3 Change-Id correlation: click → focus newest matching local commit in graph; no match → open `<change.url>` externally
- [x] 6.4 Refresh policy in `useGerrit`: on enable, window focus (≥30 s throttle), after successful review push, manual — never inside `fetchAll`

## 7. Trailer display & amend UX

- [x] 7.1 Trailer parser in renderer lib (`lib/trailers.ts`): split final trailer paragraph per git trailer rules; unit tests (no trailers, mixed body, multiple trailers)
- [x] 7.2 `CommitDetail`: render trailer block as structured metadata; Change-Id pill links to host in Gerrit mode; body text excludes trailer paragraph
- [x] 7.3 `WorkingTree`: amend notice gated by mode — force-push warning outside Gerrit mode, patchset hint inside

## 8. Regression & verification

- [x] 8.1 Non-Gerrit baseline check: with mode off/unset, toolbar, push, amend warning, and commit detail render identical to pre-change — all Gerrit UI is behind `gerrit.enabled` / `gerrit.suggested` conditionals; the only non-mode-gated change is trailer pills in commit detail, which the spec explicitly requires outside Gerrit mode too (without links)
- [x] 8.2 Run full test suite + typecheck — typecheck clean; 137/139 pass, the 2 failures are pre-existing on clean HEAD (macOS `/private/var` symlink assertion in index-lock.test.ts, unrelated)
- [x] 8.3 Verified end-to-end via CDP + playwright-core on a `.gitreview` fixture repo: banner → enable modal (prefilled from .gitreview) → toolbar "Push for review" swap → amend patchset hint → Change-Id/Signed-off-by pills with clean body → Changes panel error-state degradation. Detection also confirmed live against a real googlesource.com repo (added googlesource/review-host heuristics as a result)
- [ ] 8.4 (Optional stretch, deliberately skipped) "Install commit-msg hook" button fetching `/tools/hooks/commit-msg` from host

## 9. Real-host hardening + change nodes (follow-up in same change)

- [x] 9.1 REST auth via git's `http.cookiefile` (`cookieHeaderForHost` in gerrit-utils, wired in `gerrit:list-changes`); precedence stored creds → git cookies → anonymous; auth source label surfaced in panel header; 401/403 hint in panel error state
- [x] 9.2 googlesource host canonicalization (`canonicalGerritRestHost`, main + renderer twin in `lib/gerritHost.ts`): clone host `X.googlesource.com` → REST/UI host `X-review.googlesource.com`; applied at detection, on config load (heals stale configs), and on every mode write
- [x] 9.3 Detection heuristics extended: `*.googlesource.com`, `review.*` / `*-review.*` hosts (validated against the user's real googlesource repo)
- [x] 9.4 Open changes as graph nodes: `GitService.syncGerritChangeRefs` fetches current patchsets into `refs/gitgud/changes/<n>` (+prune, +`clearGerritChangeRefs` on disable); `--decorate-refs` set extended so the refs decorate the log without losing the HEAD arrow; sync triggered from `useGerrit` only when the patchset set changes
- [x] 9.5 Change pills: `RefGroup.isGerritChange`, `#<number>` name, dashed `ref-gerrit` styling, read-only (no drag/context menu), rendered in graph pills and commit detail
- [x] 9.6 Tests: cookie parsing (domain match, expiry, HttpOnly, no cross-host leak), canonical host mapping, fetch refspec builder, refs grouping incl. detached-HEAD guard, and a bare-repo integration test for sync/prune/clear + log decoration
- [x] 9.7 Live verification: REST probe against the real private googlesource host — anonymous 401, gitcookies 200 with 15 open changes on the `-review` host

## 10. Tree-first UX (changes panel removed)

- [x] 10.1 Remove the "Changes" advanced-bar button and the right-panel `GerritPanel` (graph nodes are the surface); REST failures now surface as a one-time-per-error warning toast with an auth hint on 401/403
- [x] 10.2 Fetch `o=ALL_REVISIONS`: `GerritChange.patchsets` carries the full amendment history (sha, number, kind, created), newest first
- [x] 10.3 Commit detail Gerrit block on change-node selection: change number (opens in browser), WIP, target branch, owner, amendment list with current patchset marked
- [x] 10.4 Outdated-base labeling: commits matching an OLD patchset SHA of an open change get a synthetic renderer-only `refs/gitgud/outdated/<n>` marker → dimmed `#<n>` pill (history icon) instead of an anonymous orphan node; selection shows an "outdated — patchset k of m" notice with jump-to-current
- [x] 10.5 One node per change stays the rule: only the current patchset ref is mirrored; old patchsets are never fetched as refs
- [x] 10.6 Tests: refs grouping for outdated markers, mapGerritChange patchset history; full suite + typecheck green
