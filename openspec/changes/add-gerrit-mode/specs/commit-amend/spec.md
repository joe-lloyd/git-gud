# commit-amend Specification (delta)

## MODIFIED Requirements

### Requirement: Force-push warning when amending pushed commits
The system SHALL detect when HEAD is at-or-behind its upstream (i.e., already pushed) and display a mode-aware notice under the amend checkbox. Outside Gerrit mode the notice SHALL remain the yellow warning: "This commit has been pushed — amending will require force-push." When Gerrit mode is active, the force-push warning SHALL be replaced by a neutral informational hint: "Amending creates a new patchset when pushed for review." The notice is informational only and SHALL NOT block submission in either mode.

#### Scenario: Pushed commit shows warning
- **WHEN** the user toggles amend outside Gerrit mode
- **AND** `status.ahead === 0` for the current branch
- **THEN** a warning banner appears under the checkbox describing the force-push consequence

#### Scenario: Unpushed commit shows no warning
- **WHEN** the user toggles amend outside Gerrit mode
- **AND** `status.ahead > 0`
- **THEN** no warning is shown

#### Scenario: Gerrit mode shows patchset hint instead
- **WHEN** the user toggles amend with Gerrit mode active
- **AND** `status.ahead === 0` for the current branch
- **THEN** no force-push warning is shown
- **AND** a neutral hint states that amending creates a new patchset when pushed for review
