# peer-remote-repos Specification (delta)

## ADDED Requirements

### Requirement: Remote repository tabs
Opening a repository from a peer SHALL create a normal tab whose path is `gitgud-peer://<peerId>/<absolute path on the peer>`. The graph, sidebar, commit detail, diff viewer and worktree list SHALL render the peer's state through the same IPC handlers used for local repos. Tabs SHALL show a peer glyph; the sidebar repo header SHALL read `<machine> : <repo>` with a status dot, and clicking it SHALL open a location menu listing every machine that has a repo of that name (this machine + connected peers, current one marked) — picking one opens that copy. Local copies offer "Reveal in file manager"; a remote copy states it cannot be opened here. There is deliberately no banner.

#### Scenario: Open a remote repo
- **WHEN** the user picks a repo from a connected peer
- **THEN** a tab opens showing that repo's lane graph, branches, tags, stashes and status exactly as the peer sees them

#### Scenario: Worktrees of a remote repo
- **WHEN** the remote repo has linked worktrees
- **THEN** they appear in the sidebar with peer URIs and switching between them stays inside the one tab

### Requirement: Live updates from the peer
While a remote tab is open the client SHALL subscribe to the peer's event stream for that repo; `repo-changed` events trigger the same silent refresh as the local filesystem watcher, and the peer's git-activity records appear in the client's console dock tagged with the peer URI.

#### Scenario: Commit on the other machine
- **WHEN** someone commits in the repo on the peer machine
- **THEN** the remote tab's graph shows the commit within ~2 s without user interaction

### Requirement: Remote sync operations
Fetch, Pull (all modes), Push, fast-forward, checkout, create branch, stash save/pop/apply and push tag from a remote tab SHALL execute on the peer machine and report the peer's result (success, error kind) through the existing toasts and recovery prompts.

#### Scenario: Pull on a remote tab
- **WHEN** the user clicks Pull on a remote tab
- **THEN** `git pull` runs on the peer with the peer's credentials and the tab refreshes with the result

#### Scenario: Refused operation
- **WHEN** the user tries to stage a file or reset on a remote tab
- **THEN** a toast explains the action isn't available on a remote repository and nothing runs on the peer

### Requirement: Remote tabs survive restarts and outages
Remote tabs SHALL persist in the session like local tabs. On restore or when the peer is unreachable the tab is kept and shows an error state with Retry instead of being dropped; the command console is disabled for remote tabs and the location menu explains the folder cannot be opened here (Retry connection is offered when the peer is offline).

#### Scenario: Peer offline at launch
- **WHEN** the app restores a remote tab whose peer is offline
- **THEN** the tab exists, shows "Peer <name> is offline" with Retry, and recovers when the peer returns
