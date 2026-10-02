# Tasks: add-companion-pr-review

## 1. Protocol (`packages/peer-protocol`)

- [x] 1.1 `forge.ts`: types (`PullSummary`, `PullDetail`, `PullFile`, `PullCommit`, `StatusCheck`, `BotVerdict`, `FileDiff`), `FORGE_READ_METHODS`, `PeerInfo.features`
- [x] 1.2 Runtime guards `parsePullSummaries`, `parsePullDetail`, `parsePullFiles`, `parseFileDiff`, `parsePullCommits`
- [x] 1.3 `splitUnifiedDiff()` (renames, binaries, mode changes, `\ No newline`, quoted paths) + `rollupChecks()` + `parseBotComment()`
- [x] 1.4 Unit tests for 1.2 and 1.3

## 2. Host (`src/main/forge/`)

- [x] 2.1 `provider.ts` interface; `forgejo.ts` with a CA-pinned `https` request helper, timeouts and error mapping
- [x] 2.2 `forge-host.ts`: config → providers, `handle(method, args)`, LRU diff cache by head, TTL caches, concurrency cap, `needsReview`
- [x] 2.3 `peer-server.ts`: route `__forge*` to `host.forge`; `peer-host-core.ts`: `forge` dep + `features` in `/info`
- [x] 2.4 Tests against a fake Forgejo HTTPS server: listing, needsReview, stale head, truncation, no-forge `not-found`, token never in responses

## 3. Headless

- [x] 3.1 `config.ts`: `forges` parse/validate, default-config comment block
- [x] 3.2 `daemon.ts`: build the forge host, token-file permission check, `status` shows forges
- [x] 3.3 CLI `gitgud-headless forge check` (whoami + open PR count per forge)
- [x] 3.4 `docs/headless.md`: forge section (token scopes, CA export)

## 4. Companion

- [x] 4.1 `PeerClient` forge helpers with guards; `Machine.features`
- [x] 4.2 Shared virtualised `DiffView` (wrapping, gutter, collapsed large files); move `DiffScreen` onto it
- [x] 4.3 `PullsScreen` (toggle, rows, pull-to-refresh), Machines card
- [x] 4.4 `PullScreen` (bot card, statuses, Overview/Files/Commits, mini markdown)
- [x] 4.5 `PullFilesScreen` pager + viewed store (patchHash)
- [x] 4.6 Typecheck + logic tests (viewed store, markdown subset)

## 5. Verify

- [x] 5.1 Full test suite + companion typecheck + `expo export` bundle (one React copy). Unrelated: `peer-relay.test.ts` fails under Node 26 (IP as TLS servername in `peer-relay.ts`)
- [ ] 5.2 Live: old-mac `forge check` against git.home.arpa with a read-only token
- [ ] 5.3 On device (S23 FE): inbox → PR → swipe files → viewed survives a push

## Deferred from phase 1

- [ ] Per-PR "no wrap" toggle (D6). Lines always wrap for now.
- [ ] Desktop host (phase 1b): Settings → Integrations → Forgejo

## Phase 2 / 3 (not in this change's first cut)

- [ ] P2 `forge:review` / `forge:merge` scopes, review drafts + submit, head-guarded merge, audit lines
- [ ] P3 Host-polled push notifications, expand context, `GitHubProvider`
