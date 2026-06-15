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

## Layout

- `src/main/` — Electron main process + GitService (wraps `simple-git` + raw git)
- `src/preload/` — IPC contract surfaced as `window.gitApi`
- `src/renderer/` — React UI (Sidebar / Graph / DiffViewer / WorkingTree / right-panel slot)
- `resources/` — app icon source + generated assets
- `scripts/` — build-time helpers
- `openspec/changes/` — in-flight feature plans (proposals, specs, tasks)
