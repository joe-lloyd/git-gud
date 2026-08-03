# pull-modes Specification (delta)

## ADDED Requirements

### Requirement: Pull strategy menu
The toolbar Pull button SHALL offer a caret / right-click menu with three strategies: Pull (git's configured default), Pull fast-forward only (`--ff-only`), and Pull with rebase (`--rebase`). The plain Pull click SHALL behave exactly as before this change.

#### Scenario: Fast-forward-only pull
- **WHEN** the user picks "Pull (fast-forward only)"
- **THEN** `git pull --ff-only` runs
- **AND** on success the repo state refreshes

#### Scenario: Rebase pull
- **WHEN** the user picks "Pull (rebase)"
- **THEN** `git pull --rebase` runs, with the existing dirty-tree autostash recovery available

### Requirement: Refused fast-forward is explained
When an ff-only pull is refused because histories diverged, the system SHALL show a targeted message ("local and remote have diverged — pull with merge or rebase instead") rather than the raw git error, and SHALL NOT open the merge/rebase recovery prompt (the user explicitly requested ff-only).

#### Scenario: Diverged ff-only pull
- **WHEN** `git pull --ff-only` fails with "Not possible to fast-forward"
- **THEN** a toast explains the divergence and suggests merge/rebase pull
- **AND** no recovery modal opens
