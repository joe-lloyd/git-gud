# peer-sharing Specification (delta)

## ADDED Requirements

### Requirement: Sharing is opt-in and off by default
The system SHALL NOT open any network listener until the user enables "Share with other Git Gud instances" in Settings. Enabling starts an HTTP server bound to all interfaces on the configured port (default 47831, auto-incrementing up to +10 if busy) and a UDP discovery beacon. Disabling stops both immediately and drops every connected peer.

#### Scenario: Fresh install
- **WHEN** the app starts for the first time
- **THEN** no TCP or UDP port is bound by the peer feature

#### Scenario: Enable sharing
- **WHEN** the user turns sharing on
- **THEN** the server listens, the settings surface shows the actual port and a 6-digit pairing code, and other instances on the LAN discover the host within 10 s

### Requirement: Encrypted, pinned transport
All peer traffic SHALL be TLS 1.2+ using a per-host self-signed certificate generated once in-process. Clients SHALL learn the certificate on first contact, display its SHA-256 fingerprint before pairing, pin it at pairing, and thereafter trust only that certificate (with an explicit fingerprint check on every connection). The pairing request SHALL carry an HMAC of the host fingerprint keyed by the pairing code instead of the code itself. Plain HTTP SHALL be refused.

#### Scenario: Fingerprint comparison
- **WHEN** a client prepares to pair
- **THEN** it shows the certificate fingerprint it received, which equals the fingerprint the host shows beside its pairing code

#### Scenario: Man-in-the-middle during pairing
- **WHEN** a relay with a different certificate forwards a pairing attempt with the correct code
- **THEN** the host rejects it (proof mismatch) and issues no token

#### Scenario: Certificate changes after pairing
- **WHEN** the pinned peer presents a different certificate
- **THEN** every connection fails with a certificate error until the user forgets and re-pairs the peer

### Requirement: Stable identity and device name
Each instance SHALL generate a random `peerId` once and persist it; the display name defaults to the OS hostname and is editable. Both are advertised in the beacon and `/gitgud/info`.

#### Scenario: Rename device
- **WHEN** the user edits the device name
- **THEN** other instances see the new name on their next beacon (≤ 3 s) without re-pairing

### Requirement: Pairing code and paired-device management
The host SHALL display a 6-digit pairing code, regenerate it after every successful pairing and on demand, lock pairing for 60 s after 5 failed attempts within a minute, and list every paired device (name, id, paired-at) with a Revoke action. Only the SHA-256 of an issued token is stored on the host.

#### Scenario: Wrong code
- **WHEN** a client pairs with an incorrect code
- **THEN** the host answers 401 and no token is issued

#### Scenario: Revoke
- **WHEN** the user revokes a paired device
- **THEN** that device's next request is answered 401 and it is shown as "access revoked" on the client

### Requirement: Method allow-list and read-only mode
The host SHALL execute any listed `GitService` method on behalf of a peer, against the host's own working tree: every read method always; every write method (staging, discarding, committing, rebasing, branches, tags, stashes, worktrees, fetch/pull/push, config…) unless the share is set to read-only. The lists SHALL be explicit and cover every public `GitService` method (guarded by a test); anything not listed — private helpers, the raw `git` handle, unknown names — SHALL be refused and never reach the service. Callback arguments that cannot cross the wire (`commitStreaming`'s chunk sink) SHALL be replaced host-side with a no-op.

#### Scenario: Remote stage
- **WHEN** a peer requests `stage(["README.md"])`
- **THEN** the host stages `README.md` in its working tree and the peer's next `getStatus` shows it staged

#### Scenario: Refused unknown method
- **WHEN** a peer requests `resolveLinearRange`
- **THEN** the host returns `ok:false` with `"resolveLinearRange" can't be run on a remote repository` and runs no git command

#### Scenario: Read-only share
- **WHEN** read-only is enabled and a peer requests `pull` or `stage`
- **THEN** the request is refused with a message naming read-only mode

### Requirement: Working-tree change events for peers
While a peer is subscribed to a repository, the host SHALL watch that repository's working tree (recursively, excluding `.git/` and `node_modules/`) in addition to refs/HEAD, debounce bursts, and emit `repo-changed` so the peer's view updates within about a second of an edit on the host — without any focus event on the peer.

#### Scenario: Edit on host
- **WHEN** a file in a shared repository is modified on the host while a peer has that repo open
- **THEN** the peer receives `repo-changed` within ~1 s and refreshes its status

### Requirement: Repository allow-list
The host SHALL only serve repositories that are in its open tabs or recent-projects list. `listRepos` returns exactly that set; RPC against any other path is refused.

#### Scenario: Path probing
- **WHEN** a peer sends RPC for `/etc`
- **THEN** the host answers 403 without touching the filesystem
