# gerrit-review-push Specification (delta)

## ADDED Requirements

### Requirement: Push HEAD for review
The system SHALL provide a push-for-review action that runs `git push <remote> HEAD:refs/for/<targetBranch>` with optional Gerrit push options appended in `%opt,opt` syntax: `topic=<t>`, `wip`, `ready`, `private`. The action SHALL be a separate code path from the existing bare `push()`, which SHALL remain unchanged.

#### Scenario: Basic push for review
- **WHEN** the user pushes for review targeting `main` on remote `origin`
- **THEN** `git push origin HEAD:refs/for/main` is executed
- **AND** success is reported with a toast and the repo state refreshes

#### Scenario: Push with topic and WIP
- **WHEN** the user sets topic `login-fix` and marks WIP
- **THEN** the refspec pushed is `HEAD:refs/for/main%topic=login-fix,wip`

#### Scenario: Existing plain push is untouched
- **WHEN** the user invokes plain Push (in or out of Gerrit mode)
- **THEN** the same bare `git push [--force-with-lease]` behavior as before this change executes

### Requirement: Push-for-review UI surfaces
In Gerrit mode the toolbar's primary push action SHALL become "Push for review" (target branch defaulting to `gitgud.gerrit.branch`), with plain push and force push demoted to the caret menu. Outside Gerrit mode the toolbar SHALL be unchanged, and "Push for review…" SHALL NOT appear.

#### Scenario: Toolbar in Gerrit mode
- **WHEN** Gerrit mode is active
- **THEN** the primary push button reads "Push for review" and opens the review-push flow with target branch, topic, and WIP fields pre-filled from config

#### Scenario: Toolbar outside Gerrit mode
- **WHEN** Gerrit mode is not active
- **THEN** the toolbar push button and caret menu contain exactly the pre-change entries

### Requirement: Gerrit rejection classification
The system SHALL classify well-known Gerrit push rejections from stderr and present actionable messages: missing Change-Id footer (with a hint about the commit-msg hook), and "no new changes" (HEAD already matches the latest patchset). Unrecognized failures SHALL fall through to the generic push error toast.

#### Scenario: Missing Change-Id
- **WHEN** the push is rejected with `missing Change-Id in message footer`
- **THEN** the error toast explains that commits need a Change-Id trailer and mentions the commit-msg hook

#### Scenario: No new changes
- **WHEN** the push is rejected with `no new changes`
- **THEN** the toast states the current HEAD is already the latest patchset, not a generic failure
