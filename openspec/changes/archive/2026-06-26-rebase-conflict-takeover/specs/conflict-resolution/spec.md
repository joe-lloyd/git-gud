## ADDED Requirements

### Requirement: Worktree-safe conflict-state detection

The system SHALL detect an in-progress merge or rebase and the set of conflicted files correctly regardless of git-dir layout — including linked worktrees where `.git` is a file and the operation's control files live under `‹main-gitdir›/worktrees/‹name›/`. Detection SHALL resolve control-file locations via git (e.g. `git rev-parse --git-path`) rather than assuming `‹repo›/.git/…`.

#### Scenario: Rebase paused in a worktree is detected

- **WHEN** a rebase is paused on conflicts inside a linked worktree
- **THEN** the status reports `inRebase: true` with the conflicted files listed (not a clean state)

#### Scenario: Merge paused in a normal repo is detected

- **WHEN** a merge is paused on conflicts in a standard repository
- **THEN** the status reports `inMerge: true` with the conflicted files listed

#### Scenario: Clean repo reports no conflict state

- **WHEN** no merge or rebase is in progress
- **THEN** `inMerge` and `inRebase` are both false and the conflicted-file list is empty

### Requirement: Right-panel takeover during conflict

While a merge or rebase is in progress, the application SHALL show the conflict panel in the right panel with priority over all other right-panel modes (working tree, commit detail, multi-select), and SHALL surface a top-level indicator that the operation is paused. The conflict panel SHALL list the unresolved files and report when all are resolved (awaiting continue).

#### Scenario: Conflict panel takes over

- **WHEN** the repository is mid-merge/rebase
- **THEN** the right panel shows the conflict panel (not the working-tree/commit/multi-select view) and a banner indicates MERGE/REBASE in progress

#### Scenario: All resolved, awaiting continue

- **WHEN** every conflicted file has been resolved (staged) but the operation has not been continued
- **THEN** the panel indicates all conflicts are resolved and offers to continue

### Requirement: Resolver access

Selecting a conflicted file SHALL open the in-app resolver for that file in the center pane, where the user can take a side or hand-edit and then save & mark resolved. When a file is no longer conflicted (resolved/staged) or the operation ends, its resolver SHALL close.

#### Scenario: Open the resolver

- **WHEN** the user selects a conflicted file in the conflict panel
- **THEN** the resolver opens for that file in the center pane

#### Scenario: Resolver closes when the file is resolved

- **WHEN** the file being edited is resolved (staged) or the merge/rebase ends
- **THEN** the resolver closes automatically

#### Scenario: Save and mark resolved

- **WHEN** the user saves a resolved file from the resolver
- **THEN** the file is written and marked resolved, and the conflict panel's list updates

### Requirement: Continue / skip / abort

The conflict panel SHALL let the user continue the operation (only when all conflicts are resolved), skip the current commit (rebase only), and abort the operation. An abort SHALL require confirmation via an in-app dialog. Failures (including a continue that hits further conflicts) SHALL be reported and leave the user in the conflict UI.

#### Scenario: Continue gated on resolution

- **WHEN** unresolved files remain
- **THEN** the continue action is disabled until all are resolved

#### Scenario: Abort confirmation

- **WHEN** the user aborts the merge/rebase
- **THEN** an in-app confirmation is shown, and on confirm the operation is aborted and the repo returns to its pre-operation state
