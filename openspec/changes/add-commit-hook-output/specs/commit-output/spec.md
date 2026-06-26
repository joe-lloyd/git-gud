## ADDED Requirements

### Requirement: Capture commit and hook output

The system SHALL capture the complete stdout and stderr produced by a `git commit` (including amend) invocation — covering all git hook output — together with the process exit code, on both success and failure.

#### Scenario: Pre-commit hook output captured on success

- **WHEN** a commit runs with hooks enabled and the pre-commit hook prints output and exits 0
- **THEN** the captured log contains that hook output and the commit completes successfully

#### Scenario: Output captured on hook failure

- **WHEN** a commit runs and a hook exits non-zero, aborting the commit
- **THEN** the system captures the hook's full output and the non-zero exit code, and reports the commit as failed without discarding the output

#### Scenario: post-commit hook output captured after success

- **WHEN** the commit itself succeeds but a post-commit hook prints output
- **THEN** the commit is reported as successful and the post-commit hook output is still included in the captured log

### Requirement: Live streaming of commit output

The system SHALL stream captured output to the renderer incrementally as it is produced, correlated to the originating commit invocation, so the user sees hooks run in real time rather than only after completion.

#### Scenario: Output appears while hooks run

- **WHEN** a long-running hook (e.g. a test suite) is executing during a commit
- **THEN** the commit-output view shows the hook's output progressively before the commit finishes

#### Scenario: Stale stream isolation

- **WHEN** a new commit starts
- **THEN** only output for the current commit invocation is shown, and output from a previous invocation is not appended to it

### Requirement: Commit output shown in the center pane

The system SHALL display the captured commit/hook output in the main center pane (where the graph and diff are shown) as a dedicated view, with a clear running / success / failure state.

#### Scenario: Auto-open when hooks run

- **WHEN** the user commits without skipping hooks
- **THEN** the center pane opens the commit-output view in a running state immediately

#### Scenario: Skip view when hooks are skipped

- **WHEN** the user commits with the "Skip hooks" (`--no-verify`) option enabled
- **THEN** the commit-output view is not auto-opened and existing toast feedback is used

#### Scenario: Failure state shown

- **WHEN** a commit fails because a hook exited non-zero
- **THEN** the view indicates a failure state and shows the exit code

### Requirement: Output is copyable

The system SHALL let the user copy the full commit/hook output to the clipboard in one action, including a header with the command and exit code, so it can be pasted into an external tool such as a coding assistant.

#### Scenario: Copy full log

- **WHEN** the user clicks the copy control in the commit-output view
- **THEN** the entire captured log, prefixed with the commit command and its exit code, is written to the clipboard

### Requirement: Failure output persists until dismissed

The system SHALL keep the commit-output view open after a failed commit until the user explicitly dismisses it, so failure output is never lost to an auto-dismiss.

#### Scenario: Failure output stays visible

- **WHEN** a commit fails and the user takes no action
- **THEN** the commit-output view remains visible with the full output available to read and copy

#### Scenario: Dismiss returns to graph

- **WHEN** the user closes the commit-output view
- **THEN** the center pane returns to the commit graph, reflecting any commit that succeeded
