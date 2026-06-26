# reliable-dialogs Specification

## Purpose
TBD - created by archiving change bug-catalog-and-regression-suite. Update Purpose after archive.
## Requirements
### Requirement: No native confirmation dialogs for destructive actions

Destructive confirmations SHALL use the application's in-app modal (e.g. `ConfirmModal`), never the native `window.confirm`/`window.alert`, because native dialogs are unreliable in this Electron build and can silently resolve negative.

#### Scenario: Bulk drop uses an in-app confirm

- **WHEN** the user drops selected commits from history
- **THEN** an in-app confirmation modal is shown (not a native dialog) before history is rewritten

#### Scenario: Discard changes uses an in-app confirm

- **WHEN** the user discards a file's changes in the working tree
- **THEN** an in-app confirmation modal is shown before the changes are reverted

### Requirement: Operations never silently no-op

Every action reachable from the UI that can fail SHALL report its outcome — a success indication or a visible error — and SHALL NOT proceed as if it succeeded when the underlying operation did not.

#### Scenario: Failed operation surfaces an error

- **WHEN** an action's underlying git call returns a failure result
- **THEN** the user sees an error (toast or inline) and the UI is not reset as though it succeeded

#### Scenario: Declined confirmation leaves state unchanged

- **WHEN** the user cancels an in-app confirmation
- **THEN** nothing is mutated and the UI reflects the unchanged state

