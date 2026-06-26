## Context

The app talks to git through a single `simple-git` instance per repo (`GitService.git`, `src/main/git-service.ts:106`) plus a `child_process.spawn` path for streaming commits (`commitStreaming`). The renderer already has the resize-handle pattern (`panel-resize-handle--v/--h`, drag logic in `App.tsx`) and the main→renderer push pattern (`webContents.send`, e.g. `git:commit-output`, `updater:status`). `.app` is a flex column; a full-width dock slots after `.app-body`. There is no terminal or command-running surface today.

## Goals / Non-Goals

**Goals:**
- A bottom dock with two consoles, resizable vertically + horizontally, persisted, matching existing handle styling.
- Right console: a faithful, live, copyable log of every git command + response (incl. hooks and branch switches).
- Left console: run ad-hoc non-interactive commands at the worktree root with streamed output.
- No new npm dependencies.

**Non-Goals:**
- A full interactive terminal (PTY). Interactive TUIs / TTY prompts are out of scope.
- Editing or replaying git commands from the log (read-only).
- Persisting console *output* across sessions (only the dock layout persists).
- Sandboxing the command console (documented as POC, user-trust level = their terminal).

## Decisions

- **Central git capture via `simple-git` `outputHandler`.** Configure the instance with an `outputHandler(command, stdoutStream, stderrStream)` that accumulates per-invocation output and timing, then emits a `git:activity` event `{ id, command, args, stdout, stderr, exitCode, durationMs, ts }`. This captures *all* simple-git operations from one place rather than instrumenting every method.
  - The `commitStreaming` spawn path bypasses simple-git, so it emits an equivalent activity record itself (it already captures output + exit code).
  - *Alternative*: wrap each GitService method. Rejected — dozens of call sites, easy to miss one.
- **Command console via `child_process.spawn(shell, ['-c', cmd], { cwd: repoRoot })`.** Non-interactive; stream `stdout`/`stderr` `data` events over a `console:output` channel keyed by a run id; resolve with the exit code. A `console:cancel` kills the child. No PTY → no native dependency (consistent with the project's minimize-deps default and the prior `node-pty` rejection in `add-commit-hook-output`).
  - Use the user's `$SHELL` when set, else `/bin/sh`; run with `{ env: process.env }`. Document the macOS GUI-PATH caveat (same as commit hooks).
- **Worktree root = the active repo path.** `GitService.repoPath` is the worktree root git resolves against; the console cwd and the log scope both derive from it. Switching tabs/worktrees swaps the active `GitService`, so both consoles re-scope and reset.
- **Dock placement + layout state.** New `ConsoleDock` component rendered after `.app-body` in `.app`. App-level state: `consoleVisible`, `consoleHeight`, `consoleSplitPct`, persisted to localStorage (mirroring the right-panel/sidebar width persistence). Reuse `panel-resize-handle--h` (top edge, vertical resize) and `panel-resize-handle--v` (the split).
- **Output bounding.** Both consoles cap retained output (ring-buffer / max lines) with a truncation notice, like `commitStreaming`'s 2 MB cap, to bound memory for chatty commands.

## Risks / Trade-offs

- **Arbitrary command execution** (security) → user-typed, local-only, app-privilege; documented as POC and unsandboxed; no remote/automated input path. Mitigation: clearly a user-initiated terminal-equivalent; revisit hardening if the app ever accepts remote input.
- **`outputHandler` ordering / interleave** → stdout & stderr are separate streams; append in arrival order tagged by stream (same accepted limitation as `commitStreaming`).
- **Long-running / runaway commands** → `console:cancel` to kill; output cap to bound memory.
- **macOS GUI PATH** → a command that works in a login shell may not find tools when launched from the GUI app; inherit `process.env` and document, consistent with the hook caveat.
- **Performance under chatty git polling** (status/log on refresh) → the activity log could fill fast; cap lines and allow clear; consider a filter toggle (future).

## Migration Plan

Additive. No data migration. Ship the IPC + component; rollback = revert. Validate by: toggling the dock, resizing both axes (persisted across relaunch), switching branches (log shows the checkout command), committing with a hook (hook output appears), and running `ls` / a failing command in the left console (streamed output + exit code).

## Open Questions

- Do we want a true interactive terminal later (PTY via `node-pty` or a WASM shell)? Deferred — would reverse the no-native-deps decision; revisit if non-interactive proves too limiting.
- Should the git-activity log filter out high-frequency read commands (status/log on refresh), or show everything with a toggle? (Lean: show all, add a filter later.)
- Should command-console output persist per repo across sessions? (Lean: no — ephemeral, only layout persists.)
