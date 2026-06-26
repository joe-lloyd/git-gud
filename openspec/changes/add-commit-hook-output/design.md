## Context

Commits run through `GitService.commit()` / amend, which call `simple-git`'s `raw(["commit", ...])`. `simple-git` resolves with collapsed stdout on success and rejects with a stringified error on non-zero exit. Git hooks (pre-commit, commit-msg, prepare-commit-msg, post-commit) write progress to the child's stdout/stderr while the command runs — none of that reaches the renderer today. The renderer surfaces only `{ success, error? }`, and the error is shown in a transient inline `.wt-error` div in `WorkingTree`.

The center pane (`graph-center` in `App.tsx`) already swaps between `ConflictEditor`, `DiffViewer`, and `GraphView` based on `activeConflictFile` / `activeDiff` state. The app pushes async main→renderer events via `webContents.send` (see `updater:status`). There is no existing command-output/log component.

Constraints: org defaults — minimize dependencies (no new npm packages), TypeScript, error handling beyond the happy path. POC honesty — flag the macOS GUI PATH caveat for hooks.

## Goals / Non-Goals

**Goals:**
- Capture the complete, ordered stdout+stderr of a commit (and amend) including all hook output, on both success and failure.
- Stream it live to the renderer so hooks are visible as they run.
- Display it in the center pane as a dedicated, dismissible view with clear success/failure state.
- One-click copy of the full log (with command + exit-code header) for pasting into a coding LLM.
- Keep the view open on failure so output is never lost.

**Non-Goals:**
- Full ANSI/VT terminal emulation (colors, cursor moves). ANSI escapes are stripped for readable, paste-friendly text.
- Capturing output for other hook-running operations (merge/rebase/cherry-pick) — the component will be built reusably, but wiring those is out of scope for this change.
- Interactive hooks that prompt for stdin (GUI commits are non-interactive; such hooks already fail today).

## Decisions

### 1. Use `child_process.spawn` for commit, not `simple-git raw()`
`simple-git` discards interleaved hook output and collapses failures to a string. Replace the commit/amend execution with `spawn('git', args, { cwd, env })`, listening to `stdout`/`stderr` `data` events and the `close` event for the exit code.
- **Alternative — `simple-git .outputHandler()`**: rejected; it still rejects the promise on non-zero exit (making success/failure output paths inconsistent) and is awkward to scope to a single invocation.
- **Alternative — `node-pty`**: rejected; adds a native dependency (violates minimize-deps) just for perfect stream ordering.
- Only commit/amend change; all other git ops keep using `simple-git`.

### 2. Ordered single buffer, arrival-order append
stdout and stderr are separate pipes; OS-level interleave ordering is not guaranteed. Append chunks to one buffer in arrival order, tagging each with its stream. This is "good enough" for human reading and LLM paste. Perfect ordering is a non-goal (would need a pty).

### 3. Stream via a push channel; keep the invoke return for compatibility
- New event channel `git:commit-output` → `webContents.send` emits `{ runId, stream, chunk }` per data event and a terminal `{ runId, done: true, exitCode, success }`. Mirrors the `updater:status` pattern. Preload exposes `onCommitOutput(cb)` returning an unsubscribe fn.
- `git:commit` / `git:commit-amend` still `invoke` and now resolve to `{ success, error?, output, exitCode, hooksRan }` — existing callers keep working; the extra fields are additive.
- A `runId` correlates the stream with the invocation so stale streams can't bleed into a new commit.

### 4. Center-pane placement + new component
- New `commitOutput` state in `App.tsx`: `{ runId, lines, status: 'running'|'success'|'failed', exitCode? } | null`.
- New `CommitOutput` component (`components/CommitOutput/`) rendered in `graph-center` with priority over `GraphView`. Conflict/diff editors keep their existing precedence; committing happens from the right panel while the center shows the graph, so in practice CommitOutput replaces the graph during/after a commit.
- Close button clears `commitOutput` → returns to the graph. The graph/status refresh runs underneath so the new commit is already present when the user closes.

### 5. Auto-open only when hooks run
- When committing **without** `--no-verify`, open CommitOutput in `running` state immediately so the user watches hooks fire.
- When `--no-verify` is set, skip the panel (nothing meaningful to show) and keep today's toast behaviour.

### 6. Copy includes context header
Copy writes `$ git commit …\n(exit <code>)\n\n<log>` so an LLM gets the command and result alongside the hook output. ANSI escapes stripped via a small regex (no dependency).

### 7. Output cap
Cap the retained buffer (e.g. ~2 MB / ~5000 lines) with a "…output truncated…" marker to bound memory for pathological hooks. Last lines are the most relevant for failures, so truncate from the middle or cap the head with a notice — keep the tail.

## Risks / Trade-offs

- **stdout/stderr interleave not perfectly ordered** → arrival-order append; documented as acceptable, pty out of scope.
- **macOS GUI PATH**: GUI-launched Electron apps may lack the login-shell PATH, so a hook that works in a terminal might not find `node`/`npx`. This already affects current commits (same env) — not introduced here, but the failure now becomes *visible* in the output panel, which may surface confusing "command not found" errors. → Inherit `process.env`; document the caveat; consider a follow-up to source the login PATH.
- **Huge/streaming hook output** → buffer cap with truncation notice.
- **Stale streams across rapid commits** → `runId` correlation; renderer ignores events for non-active runId. Commit button stays disabled while running.
- **post-commit hook failure** doesn't fail the commit → report commit success but still show the post-commit output; surface its non-zero status as a warning, not a failure.
- **Behaviour change to commit path** (spawn vs simple-git) → keep arg construction identical (`-m subject`, optional `-m body`, `--no-verify`, `--signoff`, amend `--amend`/`--author`); verify success/failure parity before removing the old path.

## Migration Plan

Purely additive. No data migration. Deploy = ship; rollback = revert the change (commit reverts to `simple-git raw()`). Validate by committing in a repo with a failing pre-commit hook and confirming the full log appears and copies correctly, and with `--no-verify` confirming the panel is skipped.

## Open Questions

- Auto-collapse on success after a short delay, or always require manual close? (Leaning: keep open, manual close, since success hook output can still be useful.)
- Should the same view later cover merge/rebase/cherry-pick hook output? (Build reusably now; wire later.)
