## ADDED Requirements

### Requirement: Headless host
A Linux daemon SHALL serve the peer protocol without a window, reusing the desktop's server, TLS, store and git layers, configured by a JSONC file (name, port, bind IP/interface, discovery, readOnly, repos, scanRoots, allowPeerIds, denyMethods, pairing window, push, rendezvous, hardening keys).

#### Scenario: Serve and pair
- **WHEN** `gitgud-headless serve` runs and `gitgud-headless pair` is invoked
- **THEN** `/gitgud/info` reports `platform: linux-headless`, pairing is open for one code or the configured window, and a Git Gud GUI can pair with the printed code / payload

### Requirement: Read-only and deny-list by default
The generated config SHALL default to `readOnly: true` and `denyMethods: ["setConfig","writeFileContent"]`; a public bind SHALL force read-only unless `allowWritesOnPublicBind` is true.

### Requirement: Hardening
The daemon SHALL support `allowSourceCidrs`, `infoPublic: false`, token TTL with authenticated `__rotateToken`, escalating pairing lockout, request/headers timeouts, an append-only audit log including pairing attempts with source IP, and `tls rotate`.
