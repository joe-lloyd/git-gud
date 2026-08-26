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

### Requirement: Method whitelist and read-only mode
The host SHALL only execute whitelisted `GitService` methods on behalf of a peer: all read methods always; the sync set (`fetch`, `pull`, `push`, `fastForwardBranch`, `checkout`, `checkoutAutostash`, `createBranch`, `stashSave`, `stashPop`, `stashApply`, `pushTag`) unless the share is set to read-only. Any other method SHALL be refused with a descriptive error and never reach git.

#### Scenario: Refused write
- **WHEN** a peer requests `reset`
- **THEN** the host returns `ok:false` with `"reset" isn't available on a remote repository` and runs no git command

#### Scenario: Read-only share
- **WHEN** read-only is enabled and a peer requests `pull`
- **THEN** the request is refused with a message naming read-only mode

### Requirement: Repository allow-list
The host SHALL only serve repositories that are in its open tabs or recent-projects list. `listRepos` returns exactly that set; RPC against any other path is refused.

#### Scenario: Path probing
- **WHEN** a peer sends RPC for `/etc`
- **THEN** the host answers 403 without touching the filesystem
