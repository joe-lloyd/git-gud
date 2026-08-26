# peer-discovery-pairing Specification (delta)

## ADDED Requirements

### Requirement: LAN discovery
Every instance SHALL listen for discovery beacons on UDP 47832 (with address reuse so several instances on one machine coexist) and present discovered hosts (name, address, port, version, already-paired flag) in the connect modal. Hosts not heard from for 10 s SHALL disappear.

#### Scenario: Host appears
- **WHEN** a sharing host is on the same broadcast domain
- **THEN** it is listed in "Connect to a peer…" within 10 s with its device name

#### Scenario: Host leaves
- **WHEN** the host disables sharing or goes offline
- **THEN** it is removed from the discovered list within 10 s

### Requirement: Manual connection
The connect modal SHALL accept `host[:port]` — an IP literal or a DNS/mDNS/MagicDNS name — for peers that are not discoverable (other subnet, VPN/overlay network such as Tailscale, another building over the internet) and probe `/gitgud/info` before asking for the pairing code. The modal SHALL include a short recipe for reaching a peer over the internet via Tailscale or an SSH tunnel.

#### Scenario: Unreachable host
- **WHEN** the probe fails
- **THEN** the modal shows the connection error inline and does not ask for a code

#### Scenario: Peer reached by name over an overlay network
- **WHEN** the user pairs with `studio-pc.tail1234.ts.net`
- **THEN** pairing, pinning, RPC and the event stream work exactly as on the LAN (the pinned certificate is matched by fingerprint, not hostname)

### Requirement: Saved names survive LAN discovery
A peer saved under a name SHALL keep that name as its address. LAN discovery MAY refresh its display name and MAY be used as a live fallback address while the name is not answering, but SHALL never persist a beacon IP over a saved name. Peers saved under an IP literal continue to follow the beacon when they move.

#### Scenario: Tailscale peer comes home
- **WHEN** a peer saved as `studio-pc.tail1234.ts.net` broadcasts on the LAN as `192.168.1.20`
- **THEN** the stored address remains the name; if the connection is down the LAN address is tried for this session only

### Requirement: Pairing handshake
Pairing SHALL send `{ code, peerId, name }` to `POST /gitgud/pair`; on success the client stores `{ peerId, name, host, port, token }` encrypted with `safeStorage` and the peer becomes "connected". Tokens SHALL never be sent to the renderer.

#### Scenario: Successful pairing
- **WHEN** the user enters the code shown on the host
- **THEN** the peer moves to the connected list, the host's code rotates, and the peer's repos are listed

### Requirement: Connection lifecycle
Known peers SHALL reconnect automatically on launch and after network loss with exponential backoff (1 s → 30 s), expose a status (`connected` / `connecting` / `offline` / `revoked`), and support Disconnect (keep credentials) and Forget (delete credentials and close that peer's tabs).

#### Scenario: Host restarts
- **WHEN** a connected host goes away and comes back
- **THEN** the client shows `offline`, then `connected` again without user action, and remote tabs refresh
