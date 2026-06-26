# Git Gud

A desktop Git client built with Electron + React.

## Documentation

- [Git feature coverage](docs/git-features.md) — what we support, what's partial, what's planned.

## Development

```bash
pnpm install --ignore-scripts
pnpm dev          # start Electron dev mode
pnpm build        # build for production
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest
pnpm test:repos   # build throwaway test repos under ~/Projects/MyProjects/git-gui-test-repos
pnpm build:icon   # rebuild app icon from resources/icon.svg
```

## Testing

```bash
pnpm test --run        # run the whole suite once (CI mode)
pnpm test              # watch mode
pnpm test --run test/backend/git-service-bulk.test.ts   # a single file
```

Two tiers:

- **Integration** (`test/backend/`): spin up throwaway git repos in a temp dir and exercise `GitService` — commits, bulk squash/drop/cherry-pick/revert, worktree add/remove, streaming commit capture, range stat. These run the real `git` binary, so they're slower; the vitest `testTimeout` is raised to 20s for them.
- **Unit** (`src/renderer/test/`, `test/frontend/`): pure helpers — ref grouping/collapse, contiguous-range selection, worktree-path derivation — plus a guard test that fails if any renderer code reintroduces native `window.confirm`/`alert` (use the in-app `ConfirmModal` instead).

> CI follow-up: wire `pnpm test --run` into a GitHub Actions workflow on PRs. Not yet configured.

## Building installers

```bash
pnpm dist         # build + package installers for the current platform into dist/
pnpm dist:mac     # mac-only (.dmg + .zip in dist/)
```

Drop the resulting `.dmg` onto Applications. First launch needs Ctrl-click → **Open** (the app isn't signed — Apple Developer ID can be added later to remove the warning and unlock seamless auto-update).

## Releasing (in-app updates)

The app embeds `electron-updater`, which polls GitHub Releases on launch. To ship an update:

1. Bump `version` in `package.json` (semver — `0.1.0` → `0.2.0`).
2. Commit: `git commit -am "release: v0.2.0"`.
3. Tag and push: `git tag v0.2.0 && git push --follow-tags`.
4. GitHub Actions (`.github/workflows/release.yml`) builds macOS / Linux / Windows installers and publishes them to the matching GitHub Release.
5. Running apps see the new version within ~5 seconds of launch, download in background, and the new binary swaps in on next quit.

Local manual publish (skip Actions):

```bash
cp .env.example .env       # then paste your GH_TOKEN inside
pnpm release               # reads .env, builds, uploads to the GitHub Release
```

`.env` is gitignored. Generate the token at https://github.com/settings/tokens with the `repo` scope. If the token leaks, revoke it from the same page immediately.

## Layout

- `src/main/` — Electron main process + GitService (wraps `simple-git` + raw git)
- `src/preload/` — IPC contract surfaced as `window.gitApi`
- `src/renderer/` — React UI (Sidebar / Graph / DiffViewer / WorkingTree / right-panel slot)
- `resources/` — app icon source + generated assets
- `scripts/` — build-time helpers
- `openspec/changes/` — in-flight feature plans (proposals, specs, tasks)
