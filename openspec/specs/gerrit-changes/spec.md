# gerrit-changes Specification

## Purpose
Fetch open Gerrit changes over REST (authenticating like git itself) and surface them directly in the commit graph and commit detail — mirrored change nodes, patchset/amendment history, and structured trailers — without a separate changes panel.

## Requirements

### Requirement: Open changes fetched via Gerrit REST
In Gerrit mode with a configured host, the system SHALL fetch open changes for the repo's project from the Gerrit REST API (`/changes/?q=project:<p>+status:open` with `o=ALL_REVISIONS`), stripping the `)]}'` XSSI prefix before parsing. Requests SHALL be anonymous unless credentials are available (see auth requirement). The fetched data (change number, subject, owner, WIP state, and full patchset history) SHALL surface through the commit graph and commit detail — there is deliberately NO separate changes panel.

#### Scenario: XSSI prefix handled
- **WHEN** the Gerrit server responds with `)]}'` followed by JSON
- **THEN** the response parses successfully

#### Scenario: Fetch failure surfaces once
- **WHEN** the REST request fails (offline, DNS, 4xx/5xx, auth)
- **THEN** a single warning toast per distinct error explains why change nodes are missing (with a sign-in hint on 401/403)
- **AND** repeated focus refreshes with the same error do not re-toast

### Requirement: Gerrit credential storage
The system SHALL store optional Gerrit HTTP credentials (host, username, HTTP password) encrypted via `safeStorage` in the existing provider-auth store in `userData`. Credentials SHALL never be sent to the renderer, written to a repo, or logged; the renderer only receives an authenticated/anonymous status flag.

#### Scenario: Credentials round-trip
- **WHEN** the user saves Gerrit credentials and restarts the app
- **THEN** subsequent Gerrit REST requests authenticate via `/a/` + Basic auth
- **AND** the renderer can query only `{authenticated: true}`

### Requirement: Change detail with amendment history on node selection
Selecting a commit that is a patchset of an open change SHALL show a Gerrit block in the commit detail view: change number (linking to the change on the host), WIP state, target branch, owner, and the full amendment history (every patchset with number, kind, and date; the current one marked). The system SHALL parse the `Change-Id` trailer per commit at log time (`CommitNode.changeId`).

#### Scenario: Selecting a change node shows its amendments
- **WHEN** the user selects the graph node of an open change with 5 patchsets
- **THEN** the commit detail shows "Change #<n>" with a 5-entry patchset list, the current patchset marked

#### Scenario: Selecting an outdated patchset explains and offers a jump
- **WHEN** the user selects a commit that is an older patchset of an open change
- **THEN** the detail block states it is outdated (patchset k of m)
- **AND** offers a "jump to current" action that focuses the current patchset's node

### Requirement: Trailer display in commit detail
The commit detail view SHALL separate git trailers (final `Key: value` paragraph) from the free-text body and render them as structured metadata. In Gerrit mode a `Change-Id` trailer SHALL render as a link/pill to the change on the configured host; outside Gerrit mode trailers still render as a structured block but without Gerrit links.

#### Scenario: Change-Id rendered as pill
- **WHEN** a commit with a `Change-Id: I0123…` trailer is selected in Gerrit mode
- **THEN** the detail view shows the Change-Id as a distinct pill linking to the change on the host
- **AND** the trailer line no longer appears inside the plain body text

#### Scenario: Commit without trailers
- **WHEN** a commit whose message has no trailer paragraph is selected
- **THEN** the body renders exactly as before this change

### Requirement: REST reuses git's own authentication
When no explicit Gerrit credentials are stored, the REST client SHALL reuse git's `http.cookiefile` (the same auth git push/pull uses, e.g. `~/.gitcookies` on googlesource hosts): cookies whose domain matches the Gerrit host are attached to the request, which then goes through the `/a/` path. Cookie values SHALL never reach the renderer or logs; the renderer only learns the auth source label (`stored` / `gitcookies` / `anonymous`). Auth precedence: stored credentials, then git cookies, then anonymous.

#### Scenario: Private googlesource host authenticates via gitcookies
- **WHEN** the changes list is fetched for a host whose domain matches an entry in the configured `http.cookiefile`
- **AND** no explicit credentials are stored
- **THEN** the request authenticates with that cookie and succeeds where the anonymous request returned 401

#### Scenario: Expired or unrelated cookies are ignored
- **WHEN** the cookie file only holds expired entries or entries for other domains
- **THEN** the request falls back to anonymous

### Requirement: googlesource host canonicalization
Because googlesource serves the Gerrit UI/REST on `X-review.googlesource.com` while clones use `X.googlesource.com`, the system SHALL canonicalize googlesource hosts to the `-review` form wherever the Gerrit host is derived or persisted, and when loading a previously stored host. Non-googlesource hosts pass through unchanged.

#### Scenario: Clone host maps to review host
- **WHEN** the remote URL is `https://foo.googlesource.com/bar`
- **THEN** the Gerrit host used for REST and links is `https://foo-review.googlesource.com`

### Requirement: Open changes render as graph nodes
In Gerrit mode, after a successful open-changes fetch the system SHALL mirror each change's CURRENT patchset (one node per change — the last pushed state) into a local ref `refs/gitgud/changes/<number>` (git fetch of the change's `refs/changes/…` ref, authenticating exactly like push/pull) so the commit graph walks and renders these commits as nodes. Mirrored refs SHALL render as distinct read-only change pills (`#<number>`), SHALL be pruned when the change is no longer open, and SHALL all be removed when Gerrit mode is disabled. The mirror sync SHALL only run when the set of open patchsets actually changed. Older patchsets SHALL NOT get their own mirrored refs.

#### Scenario: Open change appears in the graph
- **WHEN** the open-changes fetch returns a change whose patchset commit is not on any local branch
- **THEN** after the ref sync the graph shows that commit as a node carrying a `#<number>` change pill

#### Scenario: Merged change disappears
- **WHEN** a previously open change is merged or abandoned and the changes list refreshes
- **THEN** its `refs/gitgud/changes/<number>` ref is pruned and the node leaves the graph (unless reachable otherwise)

#### Scenario: Disabling the mode restores the baseline graph
- **WHEN** the user disables Gerrit mode
- **THEN** all `refs/gitgud/changes/*` refs are removed and the graph shows no change pills

### Requirement: Outdated base patchsets are labeled, not orphaned
When a commit in the log is an OLDER patchset of an open change (typically the base of another open change in a relation chain), the system SHALL tag it with a dimmed `#<number>` pill marked as outdated (distinct icon, tooltip explaining a newer patchset exists) instead of leaving it as an anonymous node. The marker is renderer-side only (no git ref is created). Local unpushed commits sharing a Change-Id SHALL NOT be marked (matching is by patchset SHA, not Change-Id).

#### Scenario: Chained change on a stale base
- **WHEN** open change B's history contains change A's patchset 2 while A is currently at patchset 3
- **THEN** the patchset-2 commit renders with a dimmed outdated `#A` pill
- **AND** selecting it shows the outdated notice with a jump to A's current patchset

#### Scenario: Local amended commit is not flagged
- **WHEN** the user amends a change's commit locally (same Change-Id, new SHA, not yet pushed)
- **THEN** that local commit gets no outdated marker

### Requirement: Changes refresh policy
The changes list SHALL refresh on mode enable, on window focus (throttled to at most once per 30 seconds), after a successful push-for-review, and on manual refresh. The REST fetch SHALL NOT be part of the core local-state refresh path and SHALL NOT delay or block it.

#### Scenario: Refresh after push for review
- **WHEN** a push for review succeeds
- **THEN** the open-changes list refreshes and shows the new or updated change
