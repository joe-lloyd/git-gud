# Tasks: add-peer-connections

## 1. Protocol (pure, testable)
- [x] 1.1 `src/main/peer-protocol.ts`: wire types, `READ_METHODS` / `SYNC_METHODS` / `RESULT_SHAPED_METHODS`, `methodAccess()`, peer URI helpers (`makePeerRepoPath`, `parsePeerRepoPath`, `isPeerRepoPath`), pairing code + token helpers (`generatePairingCode`, `hashToken`, `safeEqual`), beacon encode/parse, SSE frame encode/parse
- [x] 1.2 Unit tests for all of 1.1

## 2. Host side
- [x] 2.1 `src/main/peer-store.ts`: identity, settings, paired devices (token hashes), known peers (safeStorage-encrypted tokens)
- [x] 2.2 `src/main/peer-server.ts`: `http` server — `/gitgud/info`, `/gitgud/pair` (rate-limited), `/gitgud/rpc` (auth, allow-list, whitelist, timeout), `/gitgud/events` (SSE, per-connection repo watchers, activity fan-out)
- [x] 2.3 `src/main/peer-discovery.ts`: UDP beacon sender + listener with expiry
- [x] 2.4 Integration test: server + real GitService over loopback (pair → rpc getLog → refused reset → read-only pull refusal)

## 3. Client side
- [x] 3.1 `src/main/peer-client.ts`: `PeerConnection` (probe, pair, rpc with timeout, SSE subscribe/reconnect with backoff, status) and `RemoteRepoProxy` (Proxy-based GitService look-alike with worktree path rewriting and failure shaping)
- [x] 3.2 `src/main/peer-service.ts`: glue — owns store/server/discovery/connections, exposes state snapshot, emits `peer:state`, resolves peer URIs to proxies, manages SSE subscriptions per active repo

## 4. Main wiring
- [x] 4.1 Factor `createRepoWatcher()` out of `startRepoWatchers`
- [x] 4.2 `activateRepo` / `open-path` / `add-tab` / `close-tab` peer-aware; console + reveal disabled for peer paths; activity fan-out to server
- [x] 4.3 `peer:*` IPC handlers

## 5. Preload + renderer
- [x] 5.1 `peerApi` in preload + types; `global.d.ts`; test setup mock
- [x] 5.2 `usePeers` hook
- [x] 5.3 `PeerModal` (discovered / manual / pair / browse repos) + CSS; "Connect to a peer…" in tab "+" menu and Welcome
- [x] 5.4 Peers section in `SettingsModal` (toggle, name, port, read-only, pairing code, paired devices)
- [x] 5.5 Peer glyph in `TabBar`; better error text for unreachable peers in `useGitRepo`; sidebar repo header → `machine : repo` + location menu (replaced the initial top banner after review)
- [x] 5.7 Dev release channel: `pnpm release:dev`, `EP_PRE_RELEASE` in CI
- [x] 5.8 Update channel setting (Stable / Dev) so dev builds install through the normal updater; semver-aware compare, GitHub API release picking, persisted choice (`update-channel.ts`, `test/backend/update-channel.test.ts`)
- [x] 5.6 Renderer `lib/peerPath.ts` twin + tests

## 5b. Secure transport (2026-08-26)
- [x] 5b.1 `peer-tls.ts`: in-process EC P-256 self-signed X.509 generator + fingerprint helpers; tests prove Node/OpenSSL accept it as a trust anchor and that pinning rejects other certs
- [x] 5b.2 Server → `https` (TLS 1.2+), pairing verifies `HMAC(code, fingerprint)`; client → pinned `https.request` (cert as sole CA + fingerprint check, no session resumption), TOFU probe returns the cert, fingerprint shown in Pair form and Settings
- [x] 5b.3 Store: TLS identity files (key 0600), `KnownPeer.certPem`; tests for identity reuse, proof binding, pin mismatch, MITM pairing rejection
- [x] 5b.4 Live: two instances — TLSv1.3 on the wire, plaintext refused, fingerprints match on both screens, fetch/activity over TLS (15/15 checks)

## 6. Verification
- [x] 6.1 `pnpm typecheck` + `pnpm test` green
- [x] 6.2 Two instances on this machine (dev + second dev userData) pair, browse, open remote tab, fetch — end-to-end
- [x] 6.3 Summary HTML published to the HTML Hub

## Verification notes (2026-08-25)
- Typecheck clean; vitest 31 files / 282 tests green (4 new files: protocol, store, server⇄client loopback integration, renderer peerPath twin).
- Two dev instances on one Mac (`GITGUD_USER_DATA` override, CDP 9223/9224) driven with playwright-core — 17/17 checks: beacon discovery, wrong-code rejection, pairing + code rotation, remote graph/sidebar, live repo-changed, Fetch + Pull executing on the host, denied `reset` toast, activity mirroring, revoke → banner, restart → restored tab in revoked error state.
- Found and fixed during e2e: allow-list must canonicalize paths (`/tmp` vs `/private/tmp`) or the same repo lists twice.
