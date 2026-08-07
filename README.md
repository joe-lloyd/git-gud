<div align="center">
  <img src="resources/icon.svg" width="120" alt="Git Gud logo" />
  <h1>Git Gud</h1>
  <p><strong>A powerful, beautiful Git client with a lane-colored commit graph.</strong><br/>
  Built with Electron + React.</p>
</div>

![Commit graph](docs/screenshots/graph.png)

## Features

- **Commit graph** — every branch as a colored lane, with ref pills, tag
  markers, stash diamonds, and a live "uncommitted changes" node. Handles huge
  histories via virtualized rows + canvas lanes (large repos lay out in a
  worker).
- **Full staging workflow** — file, hunk, and single-line staging; word diff
  and side-by-side views; amend / skip-hooks / sign-off commit options.
- **History surgery** — interactive rebase, squash/drop a selected range,
  cherry-pick, revert, reset, all from the commit context menu.
- **Conflict tooling** — guided conflict editor with ours/theirs/both per
  hunk, plus optional `rerere` auto-resolution.
- **Recovery built in** — reflog browser with restore, bisect wizard, patch
  import/export, clean with type-to-confirm.
- **Host integrations** — sign in to GitHub / GitLab / Bitbucket for
  authenticated push/pull and in-app remote repo creation.
- **Gerrit mode** — auto-detects Gerrit remotes (incl. googlesource.com);
  push for review (`refs/for/…` with topic/WIP), open changes rendered as
  nodes in the graph with amendment history on select, and Change-Id aware
  commit details.
- **Transparent** — the Git Activity log shows every git command the app runs;
  a built-in console prompt covers the rest.

<table>
  <tr>
    <td><img src="docs/screenshots/staging.png" alt="Staging and committing" /></td>
    <td><img src="docs/screenshots/diff.png" alt="Diff viewer with hunk staging" /></td>
  </tr>
  <tr>
    <td align="center"><em>Stage files, hunks, or single lines</em></td>
    <td align="center"><em>Word diff, side-by-side, chunk staging</em></td>
  </tr>
</table>

## Documentation

**📖 [joe-lloyd.github.io/git-gud](https://joe-lloyd.github.io/git-gud/)** — the
docs site: install walkthroughs per platform, the user guide, and every spec.
Send colleagues there rather than a bare `.dmg`; the
[install guide](https://joe-lloyd.github.io/git-gud/install/) explains the
unsigned-app warnings they'll hit.

Same content, in the repo:

- **[User guide](docs/user-guide.md)** — how to use everything, with screenshots.
- **[Git feature coverage](docs/git-features.md)** — what we support, what's partial, what's planned.
- **[Design system](docs/design/design-system.md)** — color tokens, typography, components; plus the **[icon reference](docs/design/icons.md)** every UI icon must come from.

## Provider sign-in (GitHub · GitLab · Bitbucket)

The Integrations panel connects the app to the major hosts. While connected,
push/pull/fetch against that host authenticate automatically (per-host
`http.<host>.extraheader` injection — no credential helper needed), and you can
create remote repositories from inside the app.

- **GitHub** — works out of the box: the public OAuth client ID ships with the
  app (`src/renderer/lib/github.ts`) and sign-in uses GitHub's device flow.
  Set `VITE_GITHUB_CLIENT_ID` in `.env` only to point at your own OAuth app.
- **GitLab** — sign in with a Personal Access Token (scopes `api`,
  `write_repository`); self-hosted instances supported via the Host field.
- **Bitbucket** — sign in with your username plus an app password / API token
  (Account read; Repositories read/write/admin).

Tokens are stored encrypted on-device via Electron `safeStorage`. The
`GH_TOKEN` in `.env` is unrelated: it's only for `pnpm release` (uploading
installers to GitHub Releases).

## Gerrit mode

Gerrit workflows don't use pushed branches — you push `HEAD:refs/for/<branch>`
and iterate by amending. Git Gud detects Gerrit remotes (`.gitreview`, the
commit-msg Change-Id hook, `*.googlesource.com` / `review.*` hosts, port
29418) and offers a per-repo Gerrit mode (stored in the repo's git config
under `gitgud.gerrit.*`). Nothing changes for non-Gerrit repos.

With the mode on:

- **Push for review** becomes the primary toolbar action — target branch,
  topic, WIP, and private options; plain/force push stay in the caret menu.
  Gerrit rejections (missing Change-Id, no new changes) get targeted messages.
- **Open changes appear in the graph**: each open change's current patchset is
  mirrored to a local `refs/gitgud/changes/<n>` ref and rendered as a node
  with a dashed `#<number>` pill — one node per change, pruned when it merges.
- **Selecting a change node** shows its amendment history (all patchsets with
  kind and date) in the commit detail, with a link to the change on the host.
- **Stale bases are labeled**: when a chained change still builds on an older
  patchset, that commit gets a dimmed "outdated" pill and a jump-to-current
  action instead of appearing as an anonymous orphan node.
- **Amend-friendly**: the force-push warning becomes a "creates a new
  patchset" hint, and Change-Id trailers render as pills linking to the host.

Authentication reuses what git already has: requests try stored HTTP
credentials (Settings → Gerrit), then git's `http.cookiefile` (how
googlesource authenticates), then anonymous. googlesource clone hosts are
mapped to their `…-review.googlesource.com` API host automatically.

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

## Docs site

`docs-site/` is a VitePress site published to GitHub Pages by
`.github/workflows/docs.yml` on every push to `main` that touches `docs/`,
`openspec/specs/`, or the site itself.

```bash
cd docs-site
pnpm install
pnpm dev        # local preview at http://localhost:5173/git-gud/
pnpm build      # production build into .vitepress/dist
```

It has its own lockfile (and its own `pnpm-workspace.yaml`) so VitePress never
lands in the app's dependency tree. Only the install guides under
`docs-site/install/` and the landing page are written there — the guides,
design docs, specs, and screenshots are copied out of this repo at build time by
`docs-site/scripts/sync-content.mjs`, so `docs/` stays the source of truth. Edit
the originals; the generated directories are gitignored.

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

A locally built app is never quarantined, so it opens straight away. A
*downloaded* `.dmg` is another matter — macOS reports the unsigned build as
"damaged" until the quarantine flag is cleared; the
[install guide](https://joe-lloyd.github.io/git-gud/install/macos) covers it.

## Releasing (in-app updates)

The app checks GitHub Releases on launch — `electron-updater` on Windows/Linux,
and the custom `src/main/mac-updater.ts` on macOS (Squirrel.Mac refuses to swap
an unsigned bundle, so that path downloads, verifies, and replaces the app
itself). To ship an update:

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

`.env` is gitignored. Generate the token at <https://github.com/settings/tokens> with the `repo` scope. If the token leaks, revoke it from the same page immediately.

## Layout

- `src/main/` — Electron main process + GitService (wraps `simple-git` + raw git)
- `src/preload/` — IPC contract surfaced as `window.gitApi`
- `src/renderer/` — React UI (Sidebar / Graph / DiffViewer / WorkingTree / right-panel slot)
- `resources/` — app icon source + generated assets
- `scripts/` — build-time helpers
- `docs/` — user guide, feature coverage, README screenshots
- `docs-site/` — VitePress site (install guides + everything above), deployed to GitHub Pages
- `openspec/changes/` — in-flight feature plans (proposals, specs, tasks)
