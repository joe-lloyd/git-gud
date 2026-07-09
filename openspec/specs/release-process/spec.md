# release-process Specification

## Purpose

Define how a new version of Git Gud is built and published so that releases are
reproducible, cover every supported platform, and are produced by CI rather than an
individual's machine. A release is triggered by pushing a `v*` git tag; CI builds and
publishes installers for macOS, Windows, and Linux to a GitHub Release that
electron-updater clients poll.

## Requirements

### Requirement: Releases are triggered by a version tag

A release SHALL be initiated by pushing a git tag of the form `v<semver>` (e.g. `v0.1.1`)
to `origin`. The tag's version MUST equal the `version` field in `package.json` on the
tagged commit. No other trigger (manual dispatch, branch push) is required to publish a
release.

#### Scenario: Tag push starts the release build
- **GIVEN** `package.json` `version` is `0.2.0` on `main` and the tree is clean
- **WHEN** a maintainer pushes commit + tag with `git push origin main --follow-tags` where the tag is `v0.2.0`
- **THEN** the `.github/workflows/release.yml` workflow starts within seconds
- **AND** it runs one build job per OS in the matrix (macOS, Windows, Linux)

#### Scenario: Tag version disagrees with package.json
- **WHEN** the pushed tag is `v0.2.0` but the tagged commit's `package.json` says `0.1.9`
- **THEN** this is a release defect and the maintainer MUST re-tag the corrected commit rather than ship a mismatched build

### Requirement: A release publishes installers for all three platforms

A successful release SHALL attach installers and electron-updater manifests for every
supported platform to the GitHub Release for that tag. The artifact set MUST include the
macOS dmg + zip (arm64 and x64) with `latest-mac.yml`, the Windows NSIS `Setup .exe` with
`latest.yml`, and the Linux AppImage with `latest-linux.yml`, plus the `.blockmap`
sidecars used for differential updates.

#### Scenario: Release contains every platform's artifacts
- **WHEN** all matrix jobs complete successfully
- **THEN** the GitHub Release for the tag contains the macOS `.dmg`/`.zip` (arm64 + x64), the Windows `Setup .exe`, and the Linux `.AppImage`
- **AND** it contains `latest-mac.yml`, `latest.yml`, and `latest-linux.yml`

#### Scenario: One platform job fails
- **WHEN** a single matrix job fails (e.g. the macOS job) while the others succeed
- **THEN** the release is incomplete and MUST NOT be considered shipped until the failing platform is rebuilt and its artifacts published
- **AND** `fail-fast` is disabled so the succeeding jobs still publish their artifacts

### Requirement: CI is the single publisher per version

For any given version, exactly one publisher SHALL upload artifacts to the GitHub Release.
The CI tag-triggered workflow is that publisher. Running a local `pnpm release` for a
version that is also tagged for CI is prohibited, because the second publisher collides
with the first when overwriting `.zip.blockmap` assets and fails the build.

#### Scenario: Local publish then CI tag for the same version
- **GIVEN** a maintainer ran `pnpm release` locally for `0.2.0`, uploading macOS assets
- **WHEN** CI later runs for tag `v0.2.0` and its macOS job tries to overwrite those assets
- **THEN** the upload fails with a `422 already_exists` on the `.zip.blockmap` files
- **AND** the correct remedy is to choose one publisher: delete the stray assets (or the release) and let CI republish, or skip the CI tag entirely

### Requirement: The build environment is pinned and reproducible

The release build SHALL use the pnpm version pinned in `package.json` via the
`packageManager` field, install dependencies with a frozen lockfile, and run dependency
build scripts only for explicitly allow-listed packages. CI MUST NOT hardcode a pnpm
version that diverges from `packageManager`.

#### Scenario: CI resolves pnpm from package.json
- **WHEN** the workflow sets up pnpm
- **THEN** it uses the version declared in `package.json` `packageManager` (no conflicting `version:` input on the setup action)
- **AND** `pnpm install` runs with `--frozen-lockfile --ignore-scripts`

#### Scenario: Icons come from a single committed PNG
- **GIVEN** `resources/icon.png` (1024×1024) is committed
- **WHEN** CI packages the installers
- **THEN** electron-builder derives every platform icon — including the macOS `.icns` — from that PNG, and CI does NOT re-render the PNG from the SVG (that needs the Electron binary, which `--ignore-scripts` intentionally skips in CI)

### Requirement: Release preconditions are enforced

A maintainer SHALL only cut a release from a clean working tree on `main` that is in sync
with `origin/main`, and SHALL NOT reuse an existing version tag for a different commit
except when deliberately re-running a failed release.

#### Scenario: Dirty tree blocks a release
- **WHEN** `git status` reports uncommitted changes
- **THEN** the release MUST NOT proceed until the changes are committed or stashed

#### Scenario: Re-running a failed release
- **GIVEN** a release failed for a config reason that has since been fixed and committed to `main`
- **WHEN** the maintainer force-moves the version tag to the fix commit and force-pushes it
- **THEN** the workflow re-runs against the corrected commit
- **AND** any partially-published assets from the prior attempt are cleared first to avoid overwrite collisions

### Requirement: macOS builds are unsigned until signing is configured

Until an Apple Developer ID is configured, macOS artifacts SHALL be produced unsigned
(`identity: null`), and macOS auto-update SHALL remain disabled. Windows and Linux
auto-update remain enabled.

#### Scenario: First launch of an unsigned macOS build
- **WHEN** a user opens a released macOS build for the first time
- **THEN** Gatekeeper requires a one-time ctrl-click → Open to run it
- **AND** the app does not auto-update on macOS until code signing is added
