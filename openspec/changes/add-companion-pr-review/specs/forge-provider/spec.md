# forge-provider Specification (delta)

## ADDED Requirements

### Requirement: Forge configuration on the headless host
`gitgud-headless` SHALL accept a `forges` array in `config.jsonc`. Each entry has `id`, `kind` (`forgejo`), `url`, `tokenFile`, and the optional `caFile`, `owners` and `bots`. The daemon SHALL refuse to load a forge whose token file is group- or world-readable, and SHALL log why. A config without `forges` SHALL behave exactly as before.

#### Scenario: Token file too open
- **WHEN** `tokenFile` has mode 0644
- **THEN** that forge is not enabled and the log says to `chmod 600` it
- **AND** the rest of the daemon serves normally

#### Scenario: Private CA
- **WHEN** `caFile` points at the Caddy root PEM
- **THEN** forge requests verify `git.home.arpa` against that CA only
- **AND** no process-wide trust setting changes

### Requirement: Forge methods on the peer channel
The peer server SHALL route methods named `__forge*` to the host's forge handler before the git method allow-list. Any paired device MAY call the read methods: `__forgeInfo`, `__forgeListPulls`, `__forgeGetPull`, `__forgeListFiles`, `__forgeFileDiff` and `__forgeListCommits`. A host with no forge configured SHALL answer `not-found`. `PeerInfo.features` SHALL include `"forge"` when at least one forge is enabled. The forge token SHALL never appear in any response or log line.

#### Scenario: No forge configured
- **WHEN** a phone calls `__forgeListPulls` on a host without `forges`
- **THEN** the reply is `ok: false, code: "not-found"` with a message naming the config key

### Requirement: Inbox listing with Needs review
`__forgeListPulls` SHALL return every open PR visible to the token, optionally filtered by `owners`, as `PullSummary` rows. Each row carries a belt rollup (`checks`), the bot verdicts and a `needsReview` flag. `needsReview` SHALL be true when the PR is open and not a draft, and either the token user is a requested reviewer or the token user has no submitted review on the PR's current head commit.

#### Scenario: Review goes stale after a push
- **WHEN** you reviewed head `A` and the author pushes head `B`
- **THEN** `needsReview` is true again

#### Scenario: Bot contexts are not belt
- **WHEN** a head has `build: success` and `jev/base-review: warning`
- **THEN** `checks` is `success` and the JEV verdict is `warning`

### Requirement: Per-file diffs pinned to a head
The host SHALL fetch a PR's unified diff once per head commit, split it per file, and cache the slices. `__forgeFileDiff` SHALL take the head SHA the caller is viewing and answer `code: "stale"` when the PR head has moved. Slices over 300 KB SHALL be truncated and flagged. Every file in `__forgeListFiles` SHALL carry a `patchHash` that changes when and only when that file's patch changes.

#### Scenario: Stale head
- **WHEN** the phone asks for a file at head `A` and the PR is now at `B`
- **THEN** the reply is `code: "stale"`, and no slice of `B` is returned for a request at `A`

#### Scenario: Renamed and binary files
- **WHEN** the diff contains a rename with edits and a binary file
- **THEN** the rename's slice is under its new path with `previous` set, and the binary has `binary: true` with no patch body
