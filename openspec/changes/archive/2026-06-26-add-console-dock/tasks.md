## 1. Main process — git activity capture

- [x] 1.1 Configure the `simple-git` instance with an `outputHandler` that accumulates per-command stdout/stderr + timing and emits a `git:activity` record via the active-repo emitter. (Exit code isn't available from `outputHandler`, so `failed` is derived from git's stderr; the spawn path below carries a real exit code.)
- [x] 1.2 Emit an equivalent `git:activity` record from the `commitStreaming` spawn path (real `exitCode`) so commit/hook runs appear in the log.
- [x] 1.3 Cap retained per-record output (200 KB) to bound memory.

## 2. Main process — command console

- [x] 2.1 Add `console:run` IPC: `spawn($SHELL || '/bin/sh', ['-c', cmd], { cwd: activeRepoPath, env })`, stream `stdout`/`stderr` over `console:output` keyed by a run id, resolve on close with the exit code.
- [x] 2.2 Add `console:cancel` (SIGTERM the child) and `console:cwd` (active worktree root).
- [x] 2.3 Strip ANSI from console + activity output.

## 3. Preload

- [x] 3.1 Expose `onGitActivity(cb)` (subscribe → unsubscribe) for `git:activity`.
- [x] 3.2 Expose `runConsoleCommand(runId, cmd)`, `cancelConsoleCommand(runId)`, `onConsoleOutput(cb)`, `getRepoRoot()`; added `GitActivity` + `ConsoleOutputEvent` types.

## 4. Renderer — ConsoleDock component

- [x] 4.1 `components/ConsoleDock/ConsoleDock.tsx` + `.css`: full-width bottom dock, top vertical-resize handle + a split handle, reusing `panel-resize-handle--h` / `--v`.
- [x] 4.2 Right console (git activity log): read-only monospace entries, auto-scroll-when-at-bottom, failed entries marked with exit code, Copy + Clear.
- [x] 4.3 Left console: cwd prompt, input with Up/Down history, streamed output, run + Stop (cancel); clears/rescopes on repo change.
- [x] 4.4 Output-delivery fix: set the run-id ref synchronously before invoking (fast commands like `pwd` could stream output back before React committed the run-id render, dropping it); wrap the run in try/catch so a missing/failed IPC surfaces an error instead of silently doing nothing.

## 5. App wiring + persistence

- [x] 5.1 Mount `ConsoleDock` after `.app-body`; added a toolbar toggle (▤).
- [x] 5.2 App state `consoleVisible` / `consoleHeight` / `consoleSplitPct`, persisted to localStorage and applied on launch.
- [x] 5.3 Both consoles subscribe on mount and reset when `repoPath` changes (the dock is keyed to the active repo).
- [x] 5.4 Route commit/hook output to the bottom git-activity console instead of the center-pane takeover: removed the center `CommitOutput` view; a hook-running commit auto-opens the dock so its activity entry (command + hook output + pass/fail) is visible.
- [x] 5.5 Default the dock to visible (hidden only if the user explicitly closed it before), so the console is present without hunting for the toggle.

## 6. Verification

- [x] 6.5 `pnpm typecheck`, `pnpm build`, and `pnpm test --run` (57 passed) pass. No new pure helper was extracted (ANSI strip / cap live inline in main), so no new unit test added there.
- [x] 6.1 (manual) Toggle dock; resize vertically and the split; persistence — verified live during the session.
- [x] 6.2 (manual) Branch switch + commit/hook output appears in the git log — verified live (commit output routed to the console).
- [x] 6.3 (manual) Run a command (`pwd`) → streamed output + exit code — verified live after the run-id-ref fix.
- [x] 6.4 (manual) Repo/worktree switch re-scopes both consoles — verified live.
