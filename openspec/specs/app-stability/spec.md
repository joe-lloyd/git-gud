# app-stability Specification

## Purpose
TBD - created by archiving change clone-audit-and-complete. Update Purpose after archive.
## Requirements
### Requirement: Boot without runtime errors

The app SHALL launch and reach the Welcome screen (or load a previously opened repo) without writing any entry of level `error` to the renderer or main-process console.

#### Scenario: First launch produces no console errors
- **WHEN** the app is started from a clean profile
- **THEN** the renderer DevTools console contains zero `console.error` entries and zero unhandled promise rejections

#### Scenario: Re-opening a previously opened repo produces no console errors
- **WHEN** a repo path persisted from a prior session is loaded automatically on launch
- **THEN** the console contains zero `console.error` entries and the graph + sidebar render successfully

### Requirement: IPC failures surface as toasts, not crashes

Every IPC handler in main SHALL return a structured result `{ ok: true, data } | { ok: false, error: string }` and the renderer SHALL convert `{ ok: false }` into a `toast.error(title, error)` call. Uncaught errors in IPC handlers MUST NOT propagate as `Error` objects across the IPC boundary.

#### Scenario: Git command fails in main
- **WHEN** a `simple-git` invocation throws (e.g. no upstream, merge conflict, detached HEAD)
- **THEN** the IPC handler catches the error and returns `{ ok: false, error: <message> }`
- **AND** the renderer displays a toast describing the failure
- **AND** the UI remains interactive

#### Scenario: Push to a branch with no upstream
- **WHEN** the user clicks Push on a branch lacking an upstream
- **THEN** the main process auto-sets `-u origin <branch>` and retries OR returns a toast-able error if that also fails
- **AND** no exception is thrown across IPC

### Requirement: UI state mirrors the local `.git` directory

The renderer's view of branches, stashes, tags, working-tree status, and the current branch SHALL match the underlying repository within 500 ms after any of: a UI-triggered git operation completes, the application window receives `focus`, or the filesystem watcher reports a change inside `.git`.

#### Scenario: External CLI commit
- **GIVEN** the app is open on a repo
- **WHEN** the user runs `git commit` in an external terminal on the same repo
- **AND** the app window regains focus OR the file watcher reports the change
- **THEN** the commit appears in the graph and the working-tree panel updates within 500 ms

#### Scenario: Checkout via context menu refreshes status
- **WHEN** the user checks out a different branch via the sidebar
- **THEN** the toolbar current-branch indicator, the graph HEAD marker, and the working-tree panel all reflect the new branch before the user's next interaction

### Requirement: Render-time exceptions do not white-screen the app

The app SHALL wrap its top-level renderer tree in an error boundary that catches render exceptions and displays a recovery state with a "Reload" action.

#### Scenario: Component throws during render
- **WHEN** a component throws while rendering
- **THEN** the error boundary catches it, shows an error message with the original error text, and offers a Reload button
- **AND** the rest of the app (toolbar, sidebar shell) remains responsive

