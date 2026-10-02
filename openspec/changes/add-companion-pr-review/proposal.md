# Proposal: add-companion-pr-review

## Why

Reviewing pull requests on the Forgejo instance (`https://git.home.arpa`) from a phone is painful in Forgejo's mobile web UI. Diffs scroll sideways. There is no per-file "viewed" state. The JEV first-pass verdict and the belt CI status are buried in the comment stream. The companion app can already read a commit and show one file's diff with syntax highlighting, so it is most of the way to a good review client. What it can't do is talk to a forge.

## What Changes

- **Forge provider layer on the host.** This is an Electron-free module shared by the desktop app and `gitgud-headless`. It holds a forge token, calls the forge's REST API, and normalises the results into protocol types that don't depend on the provider. Forgejo is the first implementation. Gitea works through the same code. GitHub can be added later behind the same interface.
- **New host-level RPC methods** (`__forge*`) on the existing pinned-TLS peer channel. They cover listing PRs across repos, PR detail (description, JEV verdict, commit statuses, reviews), the changed-file list, and one file's unified diff. The phone never sees the forge token. The relay path (once one is deployed) carries these methods like any other RPC.
- **Companion review UI.** This adds a PR inbox, a PR screen (overview, files and commits) and a swipeable file-by-file diff pager. The pager wraps lines, so there is no sideways scrolling, and each file can be marked as viewed on the phone.
- **Phase 2 (writes, behind scopes):** a review with approve, request changes or comment, including inline line comments. Merge is guarded by the head SHA. Both are gated by new per-device forge scopes the host owner grants. The defaults stay read-only.
- **Protocol hygiene:** the new forge result types get hand-written runtime guards in `@gitgud/peer-protocol`, with no new dependency. The phone validates forge results at the boundary instead of casting `unknown`.

## Capabilities

### New Capabilities
- `forge-provider`: host-side forge configuration, token handling, the provider interface, Forgejo implementation, caching and per-file diff slicing.
- `companion-pr-review`: the phone's PR inbox, PR detail, file pager, viewed state and (phase 2) review submission and merge.

### Modified Capabilities
- (peer protocol, unspecced today) new `__forge*` host methods, a `forge` feature flag in `PeerInfo`, and forge write scopes alongside the existing `fetch`/`pull`/`push` scopes.

## Impact

- `packages/peer-protocol`: forge types, guards, diff splitter, method names and scope names.
- `src/main/forge/` (new): provider interface, `forgejo.ts`, `forge-host.ts` (dispatch, cache, CA pinning).
- `src/main/peer-server.ts`: route `__forge*` to `host.forge` before the `methodAccess` check.
- `src/main/peer-host-core.ts`: `PeerServerHostDeps.forge`.
- `src/headless/config.ts` and `daemon.ts`: the `forges` config block, a token-file permission check and a `scopes` CLI that accepts forge scopes.
- Desktop (phase 1b): Settings → Integrations → Forgejo, with the token stored through `safeStorage` like GitLab/Bitbucket.
- `apps/companion`: 3 new screens, a virtualised diff list, local viewed-state storage and push categories.
- No new npm dependencies.
