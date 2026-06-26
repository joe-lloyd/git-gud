## 1. Main process — capture & stream

- [ ] 1.1 In `git-service.ts`, add a `commitStreaming(opts, onChunk)` helper that runs `git commit`/amend via `child_process.spawn` with `{ cwd: repoPath, env: process.env }`, building args identically to the current `commit`/`commitAmend` (`-m subject`, optional `-m body`, `--no-verify`, `--signoff`, `--amend`, `--author`).
- [ ] 1.2 Listen on child `stdout`/`stderr` `data` events; append chunks (tagged by stream) to a single ordered buffer and invoke `onChunk` per chunk. Resolve on `close` with `{ success, exitCode, output, hooksRan }`.
- [ ] 1.3 Add a buffer cap (~2 MB / ~5000 lines) with a truncation marker that preserves the tail of the output.
- [ ] 1.4 Strip ANSI escape sequences from output (small regex, no new dependency).
- [ ] 1.5 Replace `commit()` / `commitAmend()` to delegate to `commitStreaming`, keeping their existing return shape plus the new `output`/`exitCode`/`hooksRan` fields. Preserve success/failure parity with the old `simple-git` path.

## 2. IPC & preload

- [ ] 2.1 In `main/index.ts`, generate a `runId` per commit, pass an `onChunk` that does `webContents.send('git:commit-output', { runId, stream, chunk })`, and emit a terminal `{ runId, done: true, exitCode, success }` event.
- [ ] 2.2 Update `git:commit` / `git:commit-amend` handlers to return the extended result (`output`, `exitCode`, `hooksRan`, `runId`).
- [ ] 2.3 In `preload/index.ts`, add `onCommitOutput(cb)` (subscribe → unsubscribe fn) following the `updater:status`/`onRepoChanged` pattern; extend `CommitOpts`/`Result` types with the new fields.

## 3. CommitOutput component

- [ ] 3.1 Create `components/CommitOutput/CommitOutput.tsx` + `.css`: scrollable monospace log, running/success/failure header with exit code, auto-scroll to bottom while running, and a close button.
- [ ] 3.2 Add a Copy control that writes `$ git commit …\n(exit <code>)\n\n<log>` to the clipboard via `navigator.clipboard.writeText`.
- [ ] 3.3 Show a clear failed state (color + exit code) and a "commit succeeded" state; keep the panel open until closed.

## 4. App wiring

- [ ] 4.1 Add `commitOutput` state in `App.tsx` (`{ runId, lines, status, exitCode } | null`) and render `CommitOutput` in `graph-center` with priority over `GraphView`.
- [ ] 4.2 Subscribe to `onCommitOutput` in `App` (or a hook), appending chunks for the active `runId` and ignoring stale runIds; set status on the terminal event.
- [ ] 4.3 On close, clear `commitOutput` and ensure the graph/status has refreshed so a successful commit is reflected.

## 5. WorkingTree integration

- [ ] 5.1 In `WorkingTree` `handleCommit`, when committing without `--no-verify`, open the commit-output view in running state before awaiting the commit; with `--no-verify`, keep current toast-only behaviour.
- [ ] 5.2 Route the commit result's final output/status into `commitOutput`; keep the existing inline `.wt-error` as a fallback for non-hook errors (e.g. "No repo").

## 6. Verification

- [ ] 6.1 Test with a repo whose pre-commit hook prints output and exits 0 → output visible, commit succeeds, graph updates.
- [ ] 6.2 Test with a failing pre-commit hook → failure state, exit code, full output, copy includes header.
- [ ] 6.3 Test `--no-verify` → panel not auto-opened, toast behaviour unchanged.
- [ ] 6.4 Test amend path and a large/streaming hook (truncation marker, live scroll).
- [ ] 6.5 `pnpm typecheck` passes; manual smoke run of the app.
