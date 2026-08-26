## ADDED Requirements

### Requirement: Read-only companion device
A device pairing with `kind: "companion"` SHALL be stored read-only; the pair response SHALL say so; writes SHALL be refused host-side (403 `read-only`) and client-side before the wire. The host owner MAY grant per-device scopes (`fetch`, `pull`) which the phone runs only after explicit confirmation.

### Requirement: QR pairing pins before first request
The pairing QR/payload `gitgud-peer://pair?v=1&h=…&p=…&fp=…&c=…[&alt=…][&r=…]` SHALL carry the host fingerprint so the client pins the certificate before its first request; desktop Connect-by-address SHALL accept the same payload.

### Requirement: Push notifications are opt-in metadata
Hosts SHALL only send push notifications when the owner opted in, via Expo Push, carrying machine + repo name + event kind, debounced 30 s per device/repo/kind.
