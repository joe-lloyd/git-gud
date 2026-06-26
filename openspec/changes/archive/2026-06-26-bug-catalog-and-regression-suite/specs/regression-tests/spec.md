## ADDED Requirements

### Requirement: Automated suite runs green

The project SHALL have an automated test suite, runnable with `pnpm test`, that passes with zero failures. Pre-existing tests that target an outdated API SHALL be updated to the current API rather than left failing.

#### Scenario: Suite passes

- **WHEN** `pnpm test --run` is executed
- **THEN** all tests pass (no failures)

#### Scenario: Stale git-service tests fixed

- **WHEN** the `git-service` integration tests run
- **THEN** they call `commit({ subject, ... })` (the current `CommitOpts` API), not `commit('string')`, and their assertions on the resulting commit message pass

### Requirement: Bulk commit operations are covered

The suite SHALL verify the multi-commit git-service operations: ordering for cherry-pick/revert, contiguity resolution for squash/drop, that squash combines a contiguous range into one commit, and that non-contiguous or merge-containing selections are rejected.

#### Scenario: Squash combines a contiguous range

- **WHEN** a contiguous range of commits is squashed in a test repo
- **THEN** the range becomes a single commit and later commits are preserved

#### Scenario: Non-contiguous selection rejected

- **WHEN** squash/drop is attempted on commits with a gap between them
- **THEN** the operation returns an error and history is unchanged

### Requirement: Worktree operations are covered

The suite SHALL verify worktree add and remove: adding for a new branch creates the branch and worktree; adding surfaces git errors instead of reporting success; removing a dirty worktree fails without force and succeeds with force.

#### Scenario: Add creates a new branch

- **WHEN** a worktree is added for a branch that does not exist
- **THEN** the branch is created and the worktree appears in the worktree list

#### Scenario: Remove requires force when dirty

- **WHEN** a worktree with uncommitted changes is removed without force, then with force
- **THEN** the first call fails with an error and the second call succeeds

### Requirement: Commit-output capture is covered

The suite SHALL verify that streaming commit capture strips ANSI escape sequences and reports the process exit code and success on both clean and failing (hook-aborted) commits.

#### Scenario: ANSI stripped, exit code reported

- **WHEN** a commit runs with output containing ANSI escapes
- **THEN** the captured log is plain text and the result carries the exit code and success flag

### Requirement: Pure renderer logic is covered

The suite SHALL unit-test pure helpers that drive the UI baseline: ref grouping/collapse (one pill + `+N`), contiguous-range computation for shift-select, and the default worktree path derivation (`‹project›.worktrees/‹branch›`).

#### Scenario: Ref grouping collapses correctly

- **WHEN** a commit carries HEAD + a local branch + a remote + a tag
- **THEN** grouping yields the expected representative pill and overflow count

#### Scenario: Worktree path derivation

- **WHEN** deriving a default path for project `/a/b/proj` and branch `feature/x`
- **THEN** the result is `/a/b/proj.worktrees/feature/x`
