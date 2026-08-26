# Design: add-peer-connections

## Context

Git Gud is Electron: one main process owns a `Map<repoPath, GitService>` and the renderer talks to "the active service" through ~120 `git:*` IPC handlers. `GitService` wraps simple-git and is the single place git runs. Remote repos should reuse *all* of that — the graph, sidebar, commit detail and diff viewer must not learn a second data source.

## Goals / Non-Goals

**Goals**
- Any instance can be a host and a client simultaneously; N machines, no coordinator.
- Zero new npm dependencies.
- Existing UI renders a remote repo unchanged.
- Fetch/pull/push execute on the machine that owns the repo (its credentials, hooks, SSH agent).
- Safe by default: sharing off, pairing required, whitelist of methods, repo allow-list.

**Non-Goals (v1)**
- Encryption on the wire (TLS / Noise) — LAN-only, flagged.
- Internet / NAT traversal, relays.
- Editing files, staging, committing or rewriting history remotely.
- mDNS/Bonjour (UDP broadcast + manual entry instead).

## Decisions

### 1. Transport: HTTP/1.1 JSON-RPC + Server-Sent Events, Node `http` only
- `POST /gitgud/rpc` `{ id, repoPath, method, args }` → `{ id, ok, result | error }`.
- `GET /gitgud/events?repos=a,b` → SSE stream of `repo-changed`, `activity`, `ping`.
- `GET /gitgud/info`, `POST /gitgud/pair`.
- *Why not WebSocket*: Node has no built-in WS **server**; a hand-rolled RFC 6455 framer is more code and more risk than SSE + fetch. Request/response over HTTP is also trivially debuggable with curl.
- Body cap 5 MB, JSON only, 60 s RPC timeout (pull/push can be slow).

### 2. Discovery: UDP broadcast beacon (`dgram`)
- Every enabled host broadcasts `{ t:'gitgud-peer', v:1, peerId, name, port, version }` to `255.255.255.255:47832` every 3 s; every instance listens on 47832 with `reuseAddr` so dev + installed builds coexist on one machine. Entries expire after 10 s.
- Manual `host:port` always works (different subnets, VPN, broadcast blocked).

### 3. Pairing + auth
- Host shows a 6-digit code (random, regenerated after each successful pair and on demand). Client `POST /pair { code, peerId, name }` → host verifies (constant-time), issues a 32-byte random token, stores **only its SHA-256** with the client's id/name; client stores the raw token **encrypted with `safeStorage`** (same pattern as `gerrit-auth.json`).
- 5 failed attempts / minute locks pairing for 60 s.
- Every RPC/SSE carries `Authorization: Bearer <token>`; the host looks up the hash. Revoking a device deletes the hash → instant 401 on the client, which surfaces as "access revoked".
- Trade-off: plaintext HTTP means a LAN sniffer can read tokens and repo data. Acceptable for a home network PoC; documented, and the wire format is versioned so TLS can be added without changing the protocol.

### 4. Remote repos as a `GitService` look-alike (`RemoteRepoProxy`)
- A JS `Proxy` whose every property access returns `(...args) => connection.rpc(repoPath, method, args)`. `getRepoPath()` is local. It is stored in the same `services` map and assigned to `gitService`, so **no IPC handler changes** for reads.
- Post-processing hooks for the few results that carry paths: `getWorktrees` → paths rewritten to peer URIs so the single-tab-per-repo logic keeps working.
- Failure shaping: the host answers `{ ok:false, error }` for refused/unknown methods; the proxy throws for methods whose IPC handler wraps in try/catch, and returns `{ success:false, error }` for the handful of "result-shaped" methods whose handlers return the promise directly (`RESULT_SHAPED_METHODS` in peer-protocol).
- Tab path format: `gitgud-peer://<peerId>/<remote absolute path>` (Windows paths keep their `C:/…` form). `basename` still yields the folder name so TabBar / Sidebar labels work untouched.

### 5. Host-side whitelist + repo allow-list
- `READ_METHODS` (log, branches, status, diffs, worktrees, reflog, config get…) always allowed.
- `SYNC_METHODS` (fetch, pull, push, fastForwardBranch, checkout, checkoutAutostash, createBranch, stashSave/Pop/Apply, pushTag) allowed unless the host toggles **read-only**.
- Everything else → 403 `"<method>" isn't available on a remote repository`.
- `repoPath` must be one of the host's open tabs ∪ recent projects, else 403 — the peer cannot probe the filesystem. `listRepos` returns that set; `openRepo` lazily creates a `GitService` for one of them.

### 6. Live updates
- `createRepoWatcher(repoPath, onChange)` is factored out of `startRepoWatchers`; the host creates one per (SSE connection × subscribed repo) and tears it down with the connection.
- Host `emitActivity` also fans out to the peer server, which forwards records to connections subscribed to that repo. The client rewrites `repoPath` to the peer URI and emits them into its own git-activity console — you can watch the other machine's git commands (including your own remote pulls) live.
- Client re-opens the SSE stream whenever its set of active peer repos changes (`?repos=` is the subscription; no server-side session state).

### 7. Persistence (all in `userData`)
- `peer-identity.json` `{ peerId, name }` — created once.
- `peer-settings.json` `{ enabled, port, name, readOnly }`.
- `peer-paired.json` — devices allowed to connect **to me**: `{ peerId, name, tokenHash, createdAt }[]`.
- `peer-known.json` — peers **I** connect to: `{ peerId, name, host, port, token }[]`, `safeStorage`-encrypted.
- Remote tabs ride on the existing `open-tabs.json` unchanged (the path is the URI).

### 8. Dev release channel
- `pnpm release:dev` bumps to a prerelease version (`1.11.0-dev.0`, then `-dev.1`…) from any branch, tags and pushes. CI sets `EP_PRE_RELEASE` for tags containing `-`, so electron-builder publishes a GitHub *pre-release*: the stable updaters (electron-updater without allowPrerelease, MacUpdater reading `releases/latest`) never see it.
- A packaged build whose version has a prerelease tag disables its own updater entirely (title "Git Gud (Dev build)", manual check explains). Going back to stable = reinstall by hand.

## Risks / Trade-offs
- **Plaintext LAN transport** — see §3. Mitigations: off by default, pairing, hashed tokens at rest, allow-lists.
- **Windows firewall** prompts on first listen — documented in the summary.
- **Long pulls** hit the 60 s RPC timeout — the operation still completes on the host; the client shows a timeout toast and the next `repo-changed` refreshes the view.
- **Beacon noise** — one 150-byte datagram every 3 s per host; negligible.

## Migration Plan
Purely additive. Nothing changes for users who never enable sharing; remote tabs only exist after an explicit pair + open. Rollback = delete the four `peer-*.json` files.

## Open Questions
- Should a remote tab's Working Tree panel show the peer's uncommitted changes read-only (it does — `getStatus`/`getFileDiff` are proxied) or be hidden? v1: shown, actions refused with a toast.
- Rotate pairing code on a timer (10 min) in addition to on-use? v1: on-use + manual.
