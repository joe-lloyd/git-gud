# Proposal: add-peer-connections

## Why

Git Gud runs against the repositories on the machine it is installed on. A developer with several machines (a Mac, a Windows box, a Linux server, a laptop…) has projects spread across all of them and today must sit in front of — or remote-desktop into — each one to fetch, pull, push or even just *look* at where a branch is. There is no way for one Git Gud to talk to another.

## What Changes

- **Peer sharing (host side)**: each Git Gud instance can opt in to *sharing* — it runs a small local HTTP server that other Git Gud instances on the LAN can connect to. Sharing is off by default, exposes only repositories the host already knows (open tabs + recent projects), and requires a one-time pairing with a code shown on the host's screen.
- **Discovery + pairing (client side)**: instances announce themselves over UDP broadcast so the "Connect to a peer…" modal lists machines on the same network automatically; a manual `host:port` entry covers everything else. Pairing exchanges the 6-digit code for a long-lived bearer token stored encrypted on the client; paired devices are listed and revocable on the host.
- **Remote repository tabs**: a repo that lives on a peer opens as a normal tab (`gitgud-peer://<peerId>/<path>`). The whole existing UI — lane graph, branches, tags, stashes, commit detail, diffs, worktrees — renders the peer's repo state because every git read is transparently proxied over the connection. Live updates flow back over Server-Sent Events (the host watches `.git` for remotely viewed repos and forwards its git-activity log).
- **Remote sync operations**: Fetch / Pull / Push (and the small set of safe navigation ops: checkout, create branch, stash save/pop/apply, fast-forward, push tag) run *on the peer machine*, with the peer's own credentials and hooks. Everything else (commit, stage, rebase, reset, clean…) is refused with a clear message — it stays local to the machine that owns the working tree. The host can additionally lock a share to read-only.
- **Many-to-many**: any instance can host and connect at the same time; there is no central server. Six machines can each see and sync the other five.

## Capabilities

### New Capabilities

- `peer-sharing`: host-side sharing toggle, identity, port, pairing code, paired-device management, method whitelist and read-only mode.
- `peer-discovery-pairing`: LAN discovery beacon, manual connect, pairing handshake, token storage, connection lifecycle (connect / reconnect / disconnect / forget).
- `peer-remote-repos`: remote repo tabs, transparent read proxy, live change + activity streaming, remote sync ops, graceful refusal of non-whitelisted operations, session persistence of remote tabs.

### Modified Capabilities

- `tabs-and-sessions` (existing behaviour): a tab's path may now be a peer URI; restore reconnects lazily and keeps the tab with an error state when the peer is offline instead of dropping it.

## Impact

- **Main process**: new `peer-protocol.ts` (pure, testable), `peer-store.ts`, `peer-server.ts`, `peer-discovery.ts`, `peer-client.ts` (connection + `RemoteRepoProxy`), `peer-service.ts` (glue); `index.ts` gains `peer:*` IPC, peer-aware `activateRepo`, and a reusable `createRepoWatcher`.
- **Preload**: new `peerApi` namespace + types.
- **Renderer**: `usePeers` hook, `PeerModal` (connect / pair / browse repos), Peers section in Settings, `PeerBanner` over remote tabs, peer glyph on tabs, "Connect to a peer…" in the tab "+" menu.
- **Dependencies**: none added — `http`, `dgram`, `crypto`, `fetch` from Node/Electron.
- **Grade**: production-grade intent for the git side (same handlers, same GitService); the transport is TLS (self-signed cert per host, pinned at pairing, pairing proof bound to the cert). mDNS and WAN relays are out of scope.
