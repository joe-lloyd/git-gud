---
title: 'Updating'
description: 'How Git Gud updates itself on macOS, Windows, and Linux — including the custom unsigned-macOS updater.'
---

# Updating

Git Gud updates itself on all three platforms. You clear the unsigned-app
warning [once, at install time](/install/) — after that, new versions arrive
in-app and never pass through a browser, so macOS never re-prompts.

## What you'll see

1. **A few seconds after launch**, the app checks the
   [GitHub releases feed](https://github.com/joe-lloyd/git-gud/releases/latest).
2. If a newer version exists it downloads **in the background**. Progress shows
   in the window title on Windows and Linux, and as a chip in the tab bar on macOS.
3. When it's ready you're prompted to restart. Do it whenever — the new version
   swaps in on quit either way.

There's also a **Check for updates** action in the app if you don't want to wait
for the launch check. Nothing polls on a timer: it's the one check per launch,
plus whatever you trigger by hand.

## Why macOS needed its own updater

The standard Electron updater hands macOS updates to Squirrel.Mac, which
**refuses to swap a bundle that isn't signed with a paid Developer ID**. On an
unsigned app the "restart to update" button silently does nothing — the app just
reopens on the old version.

So macOS gets a purpose-built path
([`src/main/mac-updater.ts`](https://github.com/joe-lloyd/git-gud/blob/main/src/main/mac-updater.ts)):

1. Read `latest-mac.yml` from the release feed and compare versions.
2. Download the ZIP matching your architecture, streaming progress.
3. **Verify its SHA-512** against the checksum in the feed — a mismatch aborts
   the update.
4. Unpack with `ditto` (which preserves the symlinks and resource forks inside
   an `.app` bundle that generic unzip libraries mangle).
5. On restart, a detached script waits for the app to exit, replaces the bundle
   in place, strips any quarantine attribute, and reopens it.

Windows and Linux stay on the standard `electron-updater` path — NSIS and
AppImage both swap unsigned builds without complaint.

## Updating by hand

Rarely needed, but if an update fails: download the new installer from the
[releases page](https://github.com/joe-lloyd/git-gud/releases/latest) and
install over the top. Your settings, open tabs, recent repositories, and stored
host tokens live outside the app bundle, so they survive.

On macOS a hand-downloaded DMG *is* browser-fetched, which means the
[quarantine step](/install/macos#_3-clear-the-quarantine-flag) applies again for
that copy.

## Where releases come from

Pushing a `v*` tag triggers
[the release workflow](https://github.com/joe-lloyd/git-gud/blob/main/.github/workflows/release.yml),
which builds macOS, Windows, and Linux artifacts on their native runners and
publishes them to a GitHub Release. The update feed is that release — there's no
separate server, and nothing to trust beyond GitHub and a public build log.
