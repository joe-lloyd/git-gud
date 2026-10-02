# Design: add-companion-pr-review

## Context

**What the companion is today** (`apps/companion`, Expo SDK 53, RN 0.79):

- Screens: `Machines → Repos → Repo (graph / working tree / activity) → Commit → Diff`. `navigation.ts` holds the stack params.
- `PeerClient.rpc(machine, repoPath, method, args)` speaks `POST /gitgud/rpc` over a TLS connection pinned to the host's fingerprint. The client only allows `READ_METHODS`, granted scopes and `__*` host methods. Results come back as `unknown` and are cast.
- `DiffScreen` fetches one file's unified diff (`getCommitFileDiff` / `getFileDiff`). It renders every line in a nested `ScrollView horizontal` + `ScrollView`, which means sideways scrolling and no virtualisation. `classifyDiffLine` and `tokenize` (`src/ui/highlight.ts`) are pure and reusable. `CodeLine` renders the tokens.
- Write model: a phone pairs as `kind: "companion"` and is read-only by default. The host owner grants per-device `scopes` (today only `fetch`/`pull`/`push`, filtered through `WRITE_METHODS` in `PeerStore.setPairedScopes`), and the host forces the safe arguments (`companionSafeArgs`).
- Push notifications: `PushNotifier` + Expo push tokens, used for `repo-changed` today.
- Reachability: direct LAN or tailnet addresses, plus a relay route. The relay code is in place, but no relay is deployed yet, so off-LAN works only over WireGuard or a tailnet for now.

**What the host side has:**

- `peer-server.ts` handles host-level methods (`__listRepos`, `__whoami`, …) inline, before `methodAccess()`. Everything else is a `GitService` method on a shared repo.
- `provider-service.ts` (GitLab/Bitbucket) and `github-service.ts` handle sign-in and repo listing only. `gerrit-service.ts` lists open Gerrit changes, which is the closest prior art for "read a review system over REST". Nothing reads pull requests.
- `gitgud-headless` runs as a LaunchAgent on `old-mac` (`com.gitgud.headless`) and is always on, inside the LAN.

**What the forge is** (checked against the live `swagger.v1.json`, Forgejo `16.0.3+gitea-1.22.0`):

- The API needs authentication for every call, so a token is mandatory.
- TLS is signed by *Caddy Local Authority*. **Node's `fetch` rejects it** (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`), even with `--use-system-ca` on Node 26. curl accepts it through the macOS keychain. The host therefore needs an explicit CA file.
- Endpoints this design uses:
  - `GET /repos/issues/search?type=pulls&state=open&review_requested|created|assigned|owner` lists PRs across all repos in one call.
  - `GET /repos/{o}/{r}/pulls/{n}` returns the PR detail: `head.sha`, `base`, `mergeable`, `draft`, `additions`/`deletions`/`changed_files`.
  - `GET /repos/{o}/{r}/pulls/{n}/files` returns `filename, previous_filename, status, additions, deletions`. **There is no patch field.**
  - `GET /repos/{o}/{r}/pulls/{n}.diff` returns the whole unified diff, which has to be split per file.
  - `GET /repos/{o}/{r}/commits/{sha}/status` returns the combined status: `jev/base-review` plus the belt contexts.
  - `GET /repos/{o}/{r}/issues/{n}/comments` returns the JEV comment, which carries the `JEV base review` marker and is updated in place.
  - `GET /repos/{o}/{r}/pulls/{n}/reviews` and `…/commits`.
  - Phase 2: `POST …/pulls/{n}/reviews` takes `event`, `body`, `commit_id` and `comments[{path, body, new_position, old_position}]`. `POST …/pulls/{n}/merge` takes `Do` and **`head_commit_id`**.

**JEV** (`HomeLab/hasaki/jev-reviewer`): a webhook service that posts one updatable PR comment and sets the `jev/base-review` status. The status is never `failure`: it is `success` for a merge verdict and `warning` for changes required. The comment has a review-focus section ranking what the human reviewer should verify. The belt (CI) is what actually gates merges.

## Goals / Non-Goals

**Goals**
- From the phone, see every open PR on `git.home.arpa` that needs attention, and get to the first diff line in two taps.
- Read a PR comfortably on a 6.4" screen: wrapped lines, one file per page, swipe to the next file, viewed ticks, and large or generated files collapsed.
- Surface JEV and belt state where you decide: on the inbox row and pinned at the top of the PR.
- Keep the forge token on the host. Reuse the pinned peer channel, pairing, relay and scopes rather than building a second auth story.
- Use a provider interface, so GitHub (Octokit is already a dependency) can be added without touching the phone.

**Non-Goals (this change)**
- Side-by-side diffs. A phone is too narrow for them, so diffs are unified only.
- Expanding context beyond the hunks. This is v2, through `GET /raw/{path}?ref=`.
- Creating PRs, editing PR metadata, labels or milestones.
- Forge webhooks into git-gud. Notifications poll from the host instead (D9).
- PR review in the *desktop* UI. The host module makes this possible, but it is out of scope.

## Decisions

### D1: The forge lives on the host and the phone talks only to git-gud

The phone calls `__forge*` methods on a paired host. That host holds the token and calls Forgejo.

**Why:** The token stays off the phone, where it would otherwise be a second credential to revoke. The phone already pins exactly one certificate per host, so it never has to learn to trust the Caddy CA. The same path works over the relay when one exists. Revocation stays a single action ("Revoke device" on the host).

**Alternative rejected:** the phone calls `git.home.arpa` directly. That needs a token and the Caddy root on the phone, works only on LAN or wg0, and gives up the existing scope enforcement.

**Which host:** **`gitgud-headless` on old-mac**. The phone is paired with it because that's where the code lives, and it is always on and inside the LAN. The desktop app follows in phase 1b with the same module and a Settings screen.

### D2: Host module layout (no Electron, no new dependencies)

```
packages/peer-protocol/src/forge.ts   pure: types, guards, method + scope names, splitUnifiedDiff()
src/main/forge/provider.ts             interface ForgeProvider
src/main/forge/forgejo.ts              ForgejoProvider (also Gitea)
src/main/forge/forge-host.ts           config → providers, dispatch, cache, CA-pinned fetch
```

`peer-server.ts` routes `method.startsWith("__forge")` to `host.forge?.handle(device, method, args)` before `methodAccess()`, the same way the other `__*` methods are handled. A host with no forge configured answers `not-found` with a clear message.

```ts
interface ForgeProvider {
  readonly id: string                 // config id, e.g. "home"
  readonly kind: 'forgejo' | 'github'
  whoami(): Promise<ForgeUser>
  listPulls(q: PullQuery): Promise<PullSummary[]>
  getPull(ref: PullRef): Promise<PullDetail>        // detail + statuses + reviews + bot verdicts
  listFiles(ref: PullRef): Promise<PullFile[]>
  rawDiff(ref: PullRef): Promise<string>            // whole unified diff for head
  listCommits(ref: PullRef): Promise<PullCommit[]>
  // phase 2
  submitReview(ref: PullRef, r: ReviewDraft): Promise<{ id: number }>
  merge(ref: PullRef, m: MergeRequest): Promise<{ merged: boolean; error?: string }>
}
type PullRef = { forge: string; repo: string /* owner/name */; number: number }
```

### D3: Transport to the forge uses an explicit CA, and the token is read from a file

`forge-host` builds its own `https.Agent({ ca })` from `caFile` (the Caddy root PEM) and uses it for every forge request. It does not set `NODE_EXTRA_CA_CERTS` process-wide, because that would widen trust for everything else the daemon does. Requests have a 15 s timeout. Errors are mapped to readable messages: 401 means the token is bad or revoked, 404 means the repo is missing or the token has no access, and a TLS failure means the CA file is wrong.

Headless config (JSONC, next to `repos`):

```jsonc
"forges": [{
  "id": "home",
  "kind": "forgejo",
  "url": "https://git.home.arpa",
  "tokenFile": "~/.config/gitgud-headless/forgejo-token",   // 0600 or the daemon refuses, like the TLS key
  "caFile": "~/.config/gitgud-headless/caddy-root.pem",
  "owners": ["joe-lloyd"]                                   // optional inbox filter
}]
```

Token: a dedicated Forgejo PAT per host. Phase 1 needs `read:repository,read:issue,read:user`. Phase 2 adds `write:repository,write:issue`. Desktop (1b) keeps the token in `provider-auth.json` through `safeStorage`, as GitLab and Bitbucket do today.

### D4: Normalised protocol types with runtime guards at the phone boundary

`peer-protocol/src/forge.ts` defines `PullSummary`, `PullDetail`, `PullFile`, `PullCommit`, `StatusCheck` and `BotVerdict`. Each has a hand-written `parseX(unknown): X | null` guard, which suits a pure package with no dependencies. `PeerClient.forge*()` helpers run the guard and turn a mismatch into `RpcError('Host sent an unexpected forge response', 'failed')`. That rules out a half-rendered screen. This change does *not* retrofit guards onto the existing git RPCs; that is a separate change.

```ts
type PullSummary = {
  forge: string; repo: string; number: number; title: string; author: string
  draft: boolean; updatedAt: string; headSha: string; base: string; head: string
  add: number; del: number; files: number; comments: number
  checks: 'success' | 'pending' | 'warning' | 'failure' | 'none'   // belt, excluding bot contexts
  bot?: BotVerdict                                                  // JEV, if present
  reviewRequested: boolean
}
type BotVerdict = { name: 'JEV'; verdict: 'merge' | 'changes_required' | 'error'; state: 'success' | 'warning' | 'error'; summary: string; url?: string }
```

**Building the inbox.** `issues/search?type=pulls&state=open` returns issues, which carry no head SHA. So for each hit `listPulls` fetches, in parallel with at most 6 requests in flight:
- `pulls/{n}`, cached by `(repo, number, updated_at)`;
- `commits/{head}/status`, for belt and bot states;
- `pulls/{n}/reviews`, for "Needs review".

The last two are cached by head SHA for 30 s. Ten open PRs cost about 30 small requests on a cold cache and almost none on a warm one.

**Bots are configured, not hard-coded.** The default is `bots: [{ name: "JEV", context: "jev/base-review", commentMarker: "<!-- jev-base-review -->" }]`. On the inbox the bot state comes from its status context. On the PR screen the host also finds the comment that holds the marker and extracts the headline (the first plain line after `## …`) and the bullets under `### Review focus`. It returns those together with the full body. Bot contexts are excluded from the belt `checks` rollup.

**"Needs review"** means an open, non-draft PR where you are a requested reviewer, or where you haven't submitted a review (approve, request changes or comment) on the current head commit. "You" is the token's user, from `GET /user`. A push after your review puts the PR back in the list. This works even though agent-opened PRs are authored under your own account and never request you as a reviewer.

### D5: Diffs are split per file on the host and cached by head SHA

Forgejo has no per-file patch endpoint. `forge-host` fetches `pulls/{n}.diff` once per `(repo, number, headSha)`. It builds the file list from that same diff, not from `/files`, so the paths, counts and `patchHash` always describe the bytes the phone will be shown. It then splits the diff with `splitUnifiedDiff()`. That function is pure, lives in `peer-protocol` and is unit-tested on renames, binaries, mode changes, `\ No newline` and paths with spaces. The host keeps the slices in an LRU cache (about 30 PRs or 64 MB). The phone asks for one file at a time:

- `__forgeFileDiff({ref, headSha, path})` returns `{ patch, truncated, binary, lines }`.
- A `headSha` that differs from the current head returns `code: "stale"`. The phone shows a "PR updated — reload" bar instead of mixing two revisions.
- Patches over 300 KB are truncated (the RPC body limit is 5 MB) and come back with `truncated: true` and an "Open in Forgejo" link.
- Every `PullFile` gets a `patchHash` (sha256 of the file's patch). Viewed state (D7) keys on it.

This mirrors what JEV does with lockfiles, where it excerpts instead of sending everything.

### D6: Companion UX

Navigation adds `Pulls`, `Pull` and `PullFiles` (the pager). The entry point is a **"Pull requests" card at the top of the Machines screen**. It appears when any paired machine reports `features: ["forge"]` in `/info`, which is additive and ignored by older hosts.

```
┌ Pull requests ────────────────────── ┐   Toggle: All open ⇄ Needs review
│ [ All open 7 ]  [ Needs review 3 ]   │   (counts on both; last choice remembered)
├──────────────────────────────────────┤
│ git-gud #212                    2h   │
│ feat(peer): forge provider layer     │
│ ● belt ✓   JEV ✓ merge   +412 −37 ·9 │   Rows: repo #n, age, title, belt dot,
│ ▓▓▓▓▓▓▓░░░ 6/9 viewed                │   JEV chip, size, local viewed progress
├──────────────────────────────────────┤
│ nsfw-ai-img-gen #151   DRAFT    1d   │
│ fix: queue backpressure              │
│ ◌ belt pending  JEV ⚠ changes 59%    │
└──────────────────────────────────────┘   Pull to refresh; stale-while-revalidate
```

```
┌ git-gud #212 ────────────────────────┐   PR screen
│ feat(peer): forge provider layer     │
│ main ← feat/forge · joe-lloyd · 2h   │
│ ┌ JEV ⚠ changes required (61%) ────┐ │   Pinned verdict card, collapsed by default;
│ │ Focus: forge-host.ts token perms │ │   expands to the review-focus list and the
│ └──────────────────────── more ▾ ──┘ │   full comment
│ belt: build ✓ test ✓ e2e ◌           │   Status contexts, tap → target_url
│ [Overview] [Files 9] [Commits 4]     │
│ …description (light markdown)…       │
│                                      │
│ [ Start reviewing → ]                │   Opens the pager at the first unviewed file
└──────────────────────────────────────┘
```

```
┌ src/main/forge/forgejo.ts  3/9 ─ ✓ ──┐   File pager: horizontal FlatList (paging),
│ M  +120 −4                           │   one page per file; header ✓ = viewed
│ @@ -0,0 +1,120 @@                    │
│  12 │+export class ForgejoProvider { │   Unified, wrapped lines; compact gutter shows
│  13 │+  constructor(private cfg: Fo  │   the NEW line number (old for deletions);
│     │   rgeConfig) {}                │   wrapped continuation keeps the gutter blank
│  14 │+                               │
│ …                                    │
├──────────────────────────────────────┤
│ ‹ prev   [ Viewed ✓ & next › ]       │   Primary action marks viewed and advances
└──────────────────────────────────────┘
```

Rendering details:
- **Virtualised.** Each file page is a `FlatList` of diff lines, built on `classifyDiffLine` + `CodeLine`. The current `DiffScreen` renders every line, which is fine for a commit file but not for a 3,000-line PR file. `DiffScreen` moves to the same component, which also fixes its sideways scrolling.
- **Wrapping.** There is no horizontal `ScrollView`. `CodeLine` wraps, and the gutter stays a fixed width. A per-PR toggle (“no wrap”) restores the horizontal scroll for wide tables.
- **Collapsed by default:** lockfiles (`pnpm-lock.yaml`, `package-lock.json`, …), files whose header marks them as generated, binaries, and patches over 1,500 lines. They show as a one-line card ("pnpm-lock.yaml · +2,341 −1,980 · tap to load"). The tap is per file and deliberate.
- **File order:** Forgejo's order, with an optional "group by directory" toggle on the Files tab. Renames show `old → new`.
- **Description and comments** are rendered with a tiny pure markdown subset: headings, lists, emphasis, inline code, fenced code (highlighted with `tokenize`) and links that open in the browser. Raw HTML is shown as text. No dependency is added.
- **Haptics and offline:** the last-loaded inbox and PR are kept in memory for the session. When the host is unreachable, the existing `Machine.lastGood` fallback logic applies, and the screen shows "offline — showing last loaded".

### D7: "Viewed" is local to the phone and keyed by patch hash

Forgejo's own viewed-files state has no public API, so the phone stores it locally in `AsyncStorage`-backed storage. It isn't a secret, so it doesn't belong in SecureStore, whose entries are size-limited. The key is `forge/repo/number/path` and the value is the `patchHash`. A new push that changes a file changes its hash, so that file drops back to unviewed while untouched files stay ticked. That matches GitHub's behaviour and is what makes re-review after a fix-up push fast. Entries for closed or merged PRs are pruned when the inbox loads.

### D8: Writes (phase 2) use new forge scopes and are confirmed on the phone

New scope names `forge:review` and `forge:merge` are added to an explicit `FORGE_WRITE_SCOPES` set in `peer-protocol`. `PeerStore.setPairedScopes` accepts `WRITE_METHODS ∪ FORGE_WRITE_SCOPES`. The host grants them with `gitgud-headless scopes <peer> forge:review` (and later in the desktop Settings). A read-only companion **without** the scope gets `read-only` back from the host, so the phone isn't the enforcement point.

- **Review:** long-press a diff line to add a draft comment. Drafts are stored locally per PR plus head SHA and map to `new_position` (an added or context line) or `old_position` (a deleted line). A "Submit review" sheet offers Comment, Approve or Request changes, a body, and the count of inline comments. Drafts against a stale head are kept but flagged.
- **Merge:** a sheet offering only the styles the repo allows (from `getPull`). It always sends `head_commit_id = headSha`, so a push made while you were reading can never be merged unseen. This is the same "never act on a snapshot you didn't see" rule JEV applies. The button is disabled while the belt contexts are pending or failing. `force_merge` and `merge_when_checks_succeed` are never sent from the phone. This follows the existing `companionSafeArgs` philosophy.
- Every forge write appends to the daemon audit log (`forge-review` / `forge-merge`, with repo, number, head and event).

### D9: Notifications (phase 3) are host-polled

The phone can't receive Forgejo webhooks, and the daemon shouldn't expose an HTTP endpoint for them. When push is enabled, `forge-host` polls `issues/search?type=pulls&state=open&since=` every 2 minutes and sends through the existing `PushNotifier` on three events: a new PR, a JEV verdict landing (the bot status changes from absent to set), and the belt finishing. Tapping the notification deep-links to `Pull`. This needs nothing new on Forgejo.

## Risks / Trade-offs

- **The forge token on old-mac can read every repo it is scoped to.** It is mitigated by a dedicated token, a 0600 file and read-only scopes in phase 1. The phone only ever gets normalised results, never the token.
- **Large diffs.** `.diff` for a huge PR can be many MB. It is fetched once per head and cached, and file slices are capped at 300 KB. The inbox never fetches diffs.
- **N+1 status calls on the inbox.** They are bounded by a concurrency cap and the head-SHA cache, and an inbox with 30 open PRs costs at most 30 small cached calls. If this becomes slow, the fallback is to drop `checks` from the list and show it only on the PR screen.
- **Line mapping for inline comments.** Forgejo's `new_position`/`old_position` are file line numbers, not diff offsets (unlike GitHub's legacy `position`). The splitter already tracks both numbers per line, so this stays a pure, testable mapping. It must be checked against a real PR before phase 2 ships.
- **Off-LAN** depends on a relay that isn't deployed yet. Until it is, this works on LAN, wg0 or a tailnet. That is a deployment gap, not a design gap.
- **Companion delivery.** These are pure JS/TS changes, so OTA can ship them once `EXPO_PROJECT_ID`/`EXPO_TOKEN` exist. Until then they ship with the next release APK.

## Migration / Rollout

1. **Phase 1, read-only, headless:** protocol types and guards, splitter, `ForgejoProvider`, `forge-host`, daemon config, peer-server routing, and the companion screens. Verify end-to-end against `git.home.arpa` from the S23 FE.
2. **Phase 1b, desktop host:** Settings → Integrations → Forgejo, plus the same module behind the GUI's peer server.
3. **Phase 2, writes:** scopes, review drafts and submission, guarded merge, audit lines.
4. **Phase 3:** polled notifications, expanding context with `raw/{path}?ref=`, and a `GitHubProvider`.

Hosts without a `forges` config are unchanged, and older phones ignore `features`.

## Open Questions

Resolved: the host is old-mac headless; the inbox is an All open ⇄ Needs review toggle (D4).

1. Does Forgejo's `/pulls/{n}/files` already honour `whitespace=ignore-change`, and is it worth exposing it as a toggle? (It is a cheap win for reformat-heavy PRs.)
