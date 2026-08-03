# Design: add-gerrit-mode

## Context

git-gud executes git via `simple-git` in one `GitService` per repo tab (`src/main/git-service.ts`), exposes ~120 IPC handlers from `src/main/index.ts`, and renders with React hooks (no store) orchestrated by `App.tsx` + `useGitRepo`. There is today **no** remote-host detection, **no** refspec-capable push (`GitService.push()` issues a bare `git push`), and `getLog` uses `--all` which never surfaces `refs/changes/*`. Provider REST access exists as a pattern in `provider-service.ts` (native `fetch`, per-provider token, `safeStorage`-encrypted JSON in `userData`).

Gerrit's model: contributors never push branches. They amend locally and push `HEAD:refs/for/<target>`; the server materializes each push as a patchset on a change keyed by the `Change-Id` trailer. Open work is only visible via the REST API (or `refs/changes/*`, which contains *every* patchset ever, with no open/merged distinction — useless for an "open changes" view on its own).

## Goals / Non-Goals

**Goals:**
- Detect "this repo talks to Gerrit" and offer a per-repo, opt-in Gerrit mode.
- Make the two core Gerrit verbs first-class when the mode is on: *push for review* and *amend into a new patchset*.
- Show open changes for the repo's project, correlated to local commits by Change-Id.
- Keep every code path identical for non-Gerrit repos (additive gating only).

**Non-Goals:**
- Review actions (vote, comment, submit, rebase-in-Gerrit) — read-only REST in this change.
- Patchset diffing (`refs/changes/NN/NNNN/P` fetch + compare) — future change.
- Multiple Gerrit remotes per repo — first matching remote wins.
- `.gitreview` writing or commit-msg hook installation — we detect the hook; installing it is a stretch task behind a button, not core.

## Decisions

### D1: Detection is layered heuristics in main, suggestion-only
`gerrit-service.ts` gets `detectGerrit(repoPath, remotes)` returning `{likely: boolean, signals: string[], remote, host?, defaultBranch?}`. Signals, in confidence order:
1. `.gitreview` file in repo root (parse `[gerrit]` host/port/project/defaultbranch — authoritative).
2. Remote URL heuristics: SSH port `29418`, path/host containing `gerrit`, `/a/` HTTP path prefix.
3. `.git/hooks/commit-msg` exists and its content mentions `Change-Id`.
4. `Change-Id:` trailers present in recent log (reuses last `getLog` output — checked renderer-side, no extra git call).

Any signal ⇒ suggest. **Why suggestion-only**: false positives (a repo named "gerrit-tools") must not flip UI modes silently; org guidance and the existing codebase favor explicit user choice (provider selection is always explicit today).

**Alternative rejected**: auto-enable on `.gitreview`. Even the authoritative signal can be stale (repo migrated to GitHub); one click to confirm is cheap.

### D2: Mode flag lives in repo-local git config
Keys: `gitgud.gerrit.enabled` (`true`/`false`/unset), `gitgud.gerrit.host` (REST base URL, e.g. `https://review.example.com`), `gitgud.gerrit.branch` (default review target), `gitgud.gerrit.project` (Gerrit project name). Read/write through existing `git:config-get`/`git:config-set` IPC — zero new persistence machinery, per-repo by construction, survives tab close, and users can set it by hand. `enabled=false` records an explicit dismissal so the suggestion banner never re-nags.

**Alternative rejected**: `userData` JSON keyed by repo path — breaks when repos move, duplicates state git config gives for free.

### D3: Push-for-review is a new method, not a `push()` extension
`GitService.pushForReview({remote, targetBranch, topic?, wip?, ready?, private?})` builds `push <remote> HEAD:refs/for/<targetBranch>[%opt[,opt…]]` (options joined per Gerrit push-option syntax: `%topic=t,wip`). New IPC `gerrit:push-for-review`. The existing `push(force)` signature and handler are untouched — the "don't break current version" constraint is enforced structurally.

Gerrit rejections come back as stderr strings; classify the two common ones for actionable toasts:
- `missing Change-Id in message footer` → offer commit-msg hook installation hint.
- `no new changes` → "HEAD is already the latest patchset."
`classifyGitArgs` gets no new verb (`push` already classifies as write).

### D4: Read-only Gerrit REST client in main, anonymous-first
`gerrit-service.ts` follows the `gitlabFetch` template: native `fetch`, `Accept: application/json`, strip Gerrit's `)]}'` XSSI prefix before `JSON.parse`. Endpoints used:
- `GET /changes/?q=project:<p>+status:open&o=CURRENT_REVISION&o=DETAILED_ACCOUNTS` (list)
- Unauthenticated by default; if a username + HTTP password are stored, requests go to `/a/`-prefixed paths with Basic auth.

Credentials: extend the `provider-auth.json` `safeStorage` pattern with a `gerrit` entry keyed by host (`{host, username, password}`); never sent to renderer, never logged. Renderer only ever sees `{authenticated: boolean}`.

Project name resolution: `.gitreview` project → else derive from remote URL path (strip leading `/`, `/a/`, trailing `.git`). Host resolution: `gitgud.gerrit.host` → else `.gitreview` → else derived from an `https` remote URL; SSH-only remotes require the user to fill the host field in the enable dialog (Gerrit REST is HTTP-only).

**Alternative rejected**: `ls-remote refs/changes/*` for the open list — no open/merged status, O(all-changes-ever) payload.

### D5: Renderer gating via one `gerrit` state slice
New hook `useGerrit(repoPath, remotes, commits)` owns `{detection, mode, changes, loading, error, actions}`. `App.tsx` composes it and passes down; every Gerrit UI element renders behind `mode.enabled`. Surfaces:
- **Suggestion banner** (dismissable) when `detection.likely && enabled unset`.
- **Gerrit panel** (sidebar section or right-panel tab, matching existing section pattern in `Sidebar.tsx`): open changes list; rows show `#number subject owner PS<n> [WIP]`; click focuses the local commit when a local commit's Change-Id matches, else offers "open in browser" (`shell.openExternal` via existing `ui` API).
- **Toolbar**: caret menu gains "Push for review…" (opens small modal for target branch/topic/WIP); when mode is on, the primary Push button label becomes "Push for review" with plain push demoted to the caret menu.
- **CommitDetail**: trailer block parsed from `%B` (split trailing `Key: value` paragraph per git trailer rules); `Change-Id` renders as a pill, linking to `<host>/q/<Change-Id>` when host known.
- **WorkingTree**: amend warning gated — Gerrit mode replaces force-push copy with "Amending creates a new patchset when pushed for review."

Change-Id ↔ local commit correlation needs Change-Id at graph scope: extend `getLog` format with `%(trailers:key=Change-Id,valueonly,separator=)` as one more `\x1f` field → `CommitNode.changeId?: string`. Cheap, backward-compatible (empty for non-Gerrit commits), avoids N× `getCommitMessage` calls.

### D6: Refresh integration
Gerrit changes fetch is **not** added to `fetchAll()`'s `Promise.all` (it hits the network, can be slow/offline, and must not delay local refresh). Instead `useGerrit` refreshes on: mode enable, window focus (throttled ≥30 s), after `pushForReview` succeeds, and manual refresh button on the panel. REST failures degrade to a panel-level error state; they never toast over normal git operations.

## Risks / Trade-offs

- [Heuristic false positives] → suggestion-only + explicit dismissal persisted (`enabled=false`).
- [REST host unreachable / SSH-only remotes] → panel shows setup hint; push-for-review still works (it's pure git) — the two features degrade independently.
- [Gerrit auth variance (LDAP, OAuth-only hosts where HTTP password is disabled)] → anonymous read covers public hosts; documented limitation, out of scope to chase every auth scheme.
- [`%(trailers…)` log-format support] → requires git ≥ 2.22 (2019); acceptable floor, and parse falls back to empty field.
- [Change-Id collision across patchsets: multiple local commits may carry the same Change-Id after rebases] → correlate to the *newest* local commit only.
- [Secrets in logs] → REST layer never passes credentials through git argv; existing `scrubSecrets` untouched; Basic header built in main only.

## Migration Plan

Additive: no data migration. Rollback = remove the `gitgud.gerrit.*` keys (or ignore them — orphaned keys are harmless). Feature ships dark for all repos until a user enables it.

## Open Questions

- Panel placement: sidebar section vs right-panel tab — decided at implementation by whichever needs less layout surgery; spec only requires "a Gerrit changes panel."
- Stretch: "Install commit-msg hook" button (`curl`-free: fetch hook body over REST `/tools/hooks/commit-msg`) — task marked optional.
