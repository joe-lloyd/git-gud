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
GH_TOKEN=ghp_… pnpm release
```

## Layout

- `src/main/` — Electron main process + GitService (wraps `simple-git` + raw git)
- `src/preload/` — IPC contract surfaced as `window.gitApi`
- `src/renderer/` — React UI (Sidebar / Graph / DiffViewer / WorkingTree / right-panel slot)
- `resources/` — app icon source + generated assets
- `scripts/` — build-time helpers
- `openspec/changes/` — in-flight feature plans (proposals, specs, tasks)
