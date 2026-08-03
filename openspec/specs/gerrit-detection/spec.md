# gerrit-detection Specification

## Purpose
Detect when an opened repository likely targets a Gerrit server and let the user explicitly opt into Gerrit mode, persisting the choice in repo-local git config while leaving non-Gerrit repos byte-for-byte unaffected.

## Requirements

### Requirement: Gerrit remote detection
The system SHALL evaluate detection signals when a repo is opened and report whether the repo likely targets a Gerrit server. Signals evaluated: a `.gitreview` file in the repo root, remote URL heuristics (SSH port 29418, `gerrit` in host or path, `/a/` HTTP path prefix), a `.git/hooks/commit-msg` hook whose content references `Change-Id`, and `Change-Id:` trailers present in recent commits. Detection SHALL be read-only and SHALL NOT change any behavior by itself.

#### Scenario: .gitreview file present
- **WHEN** a repo containing a `.gitreview` file is opened
- **THEN** detection reports `likely: true` with the `.gitreview` signal
- **AND** host, project, and default branch parsed from `.gitreview` are included in the detection result

#### Scenario: Remote URL on port 29418
- **WHEN** a repo's remote URL is `ssh://user@review.example.com:29418/project`
- **THEN** detection reports `likely: true` with the URL-heuristic signal

#### Scenario: No signals
- **WHEN** a repo with a plain GitHub remote, no `.gitreview`, no Change-Id hook, and no Change-Id trailers is opened
- **THEN** detection reports `likely: false`
- **AND** no Gerrit UI is shown anywhere

### Requirement: Suggestion banner with explicit opt-in
When detection reports likely AND the per-repo mode flag is unset, the system SHALL show a dismissable, non-blocking suggestion to enable Gerrit mode. Enabling and dismissing SHALL both persist, so the user is asked at most once per repo.

#### Scenario: User enables Gerrit mode
- **WHEN** the user accepts the suggestion
- **THEN** `gitgud.gerrit.enabled=true` is written to repo-local git config, together with resolved `gitgud.gerrit.host`, `gitgud.gerrit.project`, and `gitgud.gerrit.branch` values
- **AND** Gerrit UI surfaces activate without a restart

#### Scenario: User dismisses the suggestion
- **WHEN** the user dismisses the suggestion
- **THEN** `gitgud.gerrit.enabled=false` is written to repo-local git config
- **AND** the suggestion never reappears for this repo

#### Scenario: SSH-only remote needs a host
- **WHEN** the user enables Gerrit mode and no HTTPS host could be derived
- **THEN** the enable flow asks for the Gerrit web base URL before completing
- **AND** leaving it empty still enables the mode with the changes panel in a "host not configured" state

### Requirement: Mode flag persisted in repo-local git config
The system SHALL read and write the Gerrit mode state exclusively through repo-local git config keys (`gitgud.gerrit.enabled`, `gitgud.gerrit.host`, `gitgud.gerrit.project`, `gitgud.gerrit.branch`). The mode SHALL be toggleable from the settings surface for the open repo.

#### Scenario: Mode survives tab close and reopen
- **WHEN** Gerrit mode is enabled and the repo tab is closed and reopened
- **THEN** Gerrit mode is active immediately from the persisted config

#### Scenario: Manual toggle off
- **WHEN** the user disables Gerrit mode from settings
- **THEN** all Gerrit UI surfaces disappear
- **AND** push, amend, and commit-detail behavior revert to the non-Gerrit baseline

### Requirement: Non-Gerrit repos are unaffected
For repos where the mode flag is not `true`, the system SHALL behave byte-for-byte as before this change: no additional git invocations besides read-only detection at repo open, no new UI elements except the suggestion banner when detection is likely, and no network requests.

#### Scenario: Baseline behavior preserved
- **WHEN** a non-Gerrit repo is used for fetch/pull/push/commit/amend
- **THEN** the commands issued and UI shown are identical to the pre-change application
