## ADDED Requirements

### Requirement: Settings panel hosts rerere toggle
The system SHALL provide a Settings modal (opened from a gear icon in the Toolbar). The first entry SHALL be a toggle "Reuse recorded merge conflict resolutions (rerere)" with an inline description: "Git will remember how you resolved conflicts and auto-apply the same resolution next time the same conflict appears."

#### Scenario: Toggle reflects current repo config
- **WHEN** the Settings modal opens
- **THEN** the toggle state matches the output of `git config rerere.enabled` for the current repo

#### Scenario: Toggling on enables rerere
- **WHEN** the user toggles on
- **THEN** `git config rerere.enabled true` runs in the current repo
- **AND** subsequent merges record conflict resolutions

#### Scenario: Toggling off disables but preserves recordings
- **WHEN** the user toggles off
- **THEN** `git config rerere.enabled false` runs
- **AND** previously recorded resolutions remain on disk (not deleted)

### Requirement: Banner when rerere applies a resolution
During a merge or rebase, if rerere applies a recorded resolution, the WorkingTree panel SHALL show a banner at the top: "Rerere applied a recorded resolution to <file>. Review carefully before staging."

#### Scenario: Banner appears on auto-resolution
- **WHEN** a merge encounters a previously-recorded conflict
- **AND** rerere is enabled
- **AND** rerere applies a resolution
- **THEN** the banner appears above the file list
- **AND** the affected file is shown in the unstaged list (so the user can inspect)

### Requirement: "Forget this resolution" action on the banner
The banner SHALL include a "Forget this resolution" button that runs `git rerere forget <file>` for the affected file, allowing the user to discard a stale recording.

#### Scenario: Forget removes the recording
- **WHEN** the user clicks "Forget this resolution" on the banner
- **THEN** `git rerere forget <path>` runs
- **AND** the file's conflict markers reappear (because the recording is gone and the file needs manual resolution)
- **AND** the banner dismisses
