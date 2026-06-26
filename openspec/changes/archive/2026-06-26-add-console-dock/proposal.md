## Why

Today git runs invisibly: when you switch branches, stash, or trip a hook, the only feedback is a toast or (for commits) the dedicated commit-output view. There's no running record of *what git command ran and what it returned*, and no way to run an ad-hoc command at the worktree root without leaving the app. A bottom console dock — a command console on the left and a live git-activity log on the right — makes git's behavior observable and gives a quick scratch terminal, the way editors like VS Code surface a panel.

## What Changes

- Add a **bottom console dock** spanning the main window, holding two side-by-side consoles, that can be shown/hidden, resized vertically (dock height) and horizontally (the split between the two), with sizes persisted — using the same drag-handle pattern as the existing panels/sidebar.
- **Left — command console**: an input + scrollable output that runs **non-interactive** shell commands at the **current worktree root**, streaming stdout/stderr live with the exit code. (Not a full PTY terminal — see design; interactive TUIs are out of scope for now.)
- **Right — git activity log**: a read-only, auto-populated log of **every git command the app runs and its response** — the command line, streamed output (including hook output and checkout/switch chatter), exit code, and duration. Copyable and clearable.
- Both consoles re-scope to the active repo/worktree when the user switches tabs or worktrees.

## Capabilities

### New Capabilities
- `console-dock`: the bottom dock layout — toggle visibility, vertical + horizontal drag-resize, persistence, and the shared resize-handle affordance.
- `git-activity-log`: capturing every git invocation (command, output, exit code, duration) in the main process and streaming it to the right console as a live, copyable, clearable log.
- `command-console`: running user-entered non-interactive shell commands at the worktree root with live streamed output and exit status.

### Modified Capabilities
<!-- None — openspec/specs/ is empty. -->

## Impact

- **Main process** (`src/main/git-service.ts`, `src/main/index.ts`): add a central logging shim over the `simple-git` instance (via `outputHandler`) plus the `commitStreaming` path, emitting a `git:activity` push event; add a `console:*` IPC surface that spawns a shell (`child_process.spawn`) with `cwd` = the repo root and streams output. No new npm dependencies (Node `child_process` only).
- **Preload** (`src/preload/index.ts`): expose `onGitActivity`, `runConsoleCommand`, `onConsoleOutput`, `getRepoRoot`, and a cancel/clear surface.
- **Renderer**: new `components/ConsoleDock/` (the dock + two consoles) mounted at the bottom of `.app`; App-level state for dock visibility/height/split with localStorage persistence; reuse `panel-resize-handle` styles.
- **Security (flag)**: the left console executes arbitrary shell commands at the worktree root with the app's privileges and inherited environment. Input is user-typed and local (no remote/automated source), equivalent to the user's own terminal — but it is an intentionally powerful, unsandboxed capability and is treated as POC, not hardened.
- **Relationship**: complements the existing `add-commit-hook-output` commit-output view (center pane) — the git-activity log is the persistent, repo-wide record; commit output remains the focused live view during a commit.
