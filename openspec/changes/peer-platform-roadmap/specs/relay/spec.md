## ADDED Requirements

### Requirement: Rendezvous/relay preserves end-to-end pinning
A relay SHALL splice a client to a registered host only when the client presents `sha256(host fingerprint)`; the host's pinned TLS SHALL be negotiated through the splice; the relay SHALL see ciphertext only. Unknown peer ids and wrong hashes SHALL be answered identically.

### Requirement: Host registration is token-bound
The first registration of a peer id SHALL bind its token; later registrations with another token SHALL be refused.

#### Scenario: Pair through the relay
- **WHEN** a client pairs from a payload whose direct addresses are unreachable but which carries `r=relay://…/<peerId>#fp`
- **THEN** probe, pairing, RPC and SSE succeed through the relay and a wrong pinned certificate still fails the inner handshake
