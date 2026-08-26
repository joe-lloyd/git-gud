# Peer platform roadmap (M1–M6)

Builds on `add-peer-connections`: the same wire protocol now has three
products — the desktop GUI, a headless Linux daemon (`gitgud-headless`) and a
read-only companion phone app — plus a self-hosted rendezvous/relay so any of
them can reach any host across the internet without Tailscale.

## Why
The user has ~6 machines incl. Linux boxes without displays, wants to drive
their repos from any Git Gud GUI or glance at them from a phone, and wants
that to work from another building.

## What
- **M1 headless daemon** — Electron-free `peer-host-core`, `src/headless/*`,
  CLI (`init/serve/pair/status/devices/revoke/allow/reload/tls/audit/update`),
  systemd unit, install script, CI asset.
- **M2 shared protocol** — `packages/peer-protocol` (pure TS), consumed as
  source by desktop, daemon, phone.
- **M3 companion v1** — Expo app (`apps/companion`), QR pairing with pin-
  before-probe, per-device read-only, Expo push (opt-in), native pinned
  fetch module.
- **M4 hardening** — source CIDR filter, minimal `/info`, token TTL +
  rotation, escalating lockout, HTTP timeouts, audit with IP, exposure-
  derived read-only, `cert-changed` state, RTT/transport labels.
- **M5 relay** — `src/relay` zero-dep service, host `RelayLink`, client
  `relay://` transport, QR carries the relay route, Dockerfile.
- **M6 companion v2** — per-device write scopes (fetch/pull) with tap-to-
  approve and notification actions.

## Out of scope / deferred
Hole punching (relay-first), home-screen widgets, Node SEA single binary,
App Store submission.
