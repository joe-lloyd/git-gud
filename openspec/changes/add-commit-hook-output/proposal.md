## Why

When a commit triggers git hooks (pre-commit, commit-msg, prepare-commit-msg, post-commit), the hook output — linters, formatters, test runners — is currently captured and discarded by `simple-git`. On failure the user only sees a stringified error in a transient inline message, with no way to read the full hook log or copy it. Developers routinely need that exact output to paste into a coding LLM to diagnose a failed hook. Today that workflow is impossible from the GUI.

## What Changes

- Capture the full stdout + stderr of `git commit` (and amend) while hooks run, instead of throwing away success output and collapsing failures into a one-line string.
- Stream that output live to the renderer so the user watches hooks fire in real time rather than staring at a frozen "Committing…" button.
- Render the captured output in the **main center pane** (the area that shows the graph / diff), as a dedicated, dismissible commit-output view — not a transient toast.
- Make the output **copyable** (one-click copy of the whole log) so a failed hook's output can be dumped into a code LLM.
- Show clear success / failure state (exit code, which hook failed when derivable) and keep the panel open on failure so nothing is lost; auto-dismiss/return to graph on success is configurable behaviour.
- Respect the existing "Skip hooks" (`--no-verify`) flag — when hooks are skipped there is little to show, so the panel is only auto-opened when hooks actually run.

## Capabilities

### New Capabilities
- `commit-output`: Capturing git commit/hook stdout+stderr, streaming it to the renderer, and displaying it in the center pane as a copyable, dismissible live log with success/failure state.

### Modified Capabilities
<!-- None — no existing specs in openspec/specs/. The commit IPC behaviour change is captured within the new commit-output capability. -->

## Impact

- **Main process** (`src/main/git-service.ts`): commit/amend execution switches from `simple-git raw()` (output discarded) to a streaming child-process approach that captures stdout+stderr and exit code. New method(s) emitting incremental output.
- **IPC** (`src/main/index.ts`, `src/preload/index.ts`): commit handlers extended to stream output events to the renderer and return the final captured log; new event channel (e.g. `git:commit-output`) following the existing `updater:status` push pattern. `Result`/`CommitOpts` types extended.
- **Renderer** (`src/renderer/App.tsx`): new center-pane view + state for the active commit output; wiring from the commit trigger.
- **Renderer** (`src/renderer/components/WorkingTree/WorkingTree.tsx`): commit handler opens the output view and subscribes to streamed output.
- **New component**: `src/renderer/components/CommitOutput/` (`.tsx` + `.css`) — the live, copyable log view.
- **Dependencies**: none added (uses Node `child_process`, already available in the Electron main process). Keeps the org "minimize dependencies" default.
