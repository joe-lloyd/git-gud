---
title: 'Build from source'
description: 'Compile Git Gud yourself — the warning-free install route, and the starting point for contributing.'
---

# Build from source

Building locally sidesteps every warning on this site: an app you compiled was
never downloaded, so it carries no quarantine flag and no zone marker. It takes
about two minutes.

## Prerequisites

- **Node.js 20+**
- **pnpm** — `corepack enable pnpm` (the repo pins its version in `package.json`)
- **Git**
- macOS, Windows, or Linux — the build produces installers for whichever
  platform you run it on

## Run it from source

```bash
git clone https://github.com/joe-lloyd/git-gud.git
cd git-gud
pnpm install --ignore-scripts
pnpm dev
```

`pnpm dev` starts Electron with hot reload — good enough for daily use if you
don't mind a terminal staying open.

## Build a real installer

```bash
pnpm dist        # installers for the current platform, into dist/
pnpm dist:mac    # macOS only: .dmg + .zip
```

On macOS, drag the resulting app onto `/Applications` and open it — no
Gatekeeper prompt, because a locally built bundle is never quarantined.

::: tip Match your architecture
`electron-builder` builds for the machine you're on by default. To be explicit:
`pnpm build && pnpm exec electron-builder --mac dmg --arm64`.
:::

## Other useful scripts

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest (watch); add --run for a single pass
pnpm test:repos  # generate throwaway git repos to test against
pnpm build:icon  # re-render the app icon from resources/icon.svg
```

## How the codebase is laid out

| Path | What lives there |
| --- | --- |
| `src/main/` | Electron main process + `GitService` (wraps `simple-git` and raw git) |
| `src/preload/` | The IPC contract, surfaced to the UI as `window.gitApi` |
| `src/renderer/` | React UI — Sidebar, Graph, DiffViewer, WorkingTree, right-panel slot |
| `openspec/specs/` | The [specifications](/specs/) behind each capability |
| `docs/` | The source markdown for this site |
| `test/` | Integration tests against real git repos, plus unit tests |

Changes are proposed spec-first: write the proposal and spec under
`openspec/changes/`, implement, then archive the spec into `openspec/specs/`.
The [specs section](/specs/) is generated from those archived files.
