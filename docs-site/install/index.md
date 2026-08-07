---
title: 'Install'
description: 'Download Git Gud for macOS, Windows, or Linux — including how to clear the unsigned-app warnings.'
---

# Install Git Gud

All builds live on the [GitHub releases page](https://github.com/joe-lloyd/git-gud/releases/latest).
Pick the file for your platform, then follow the walkthrough — the first launch
needs one extra step on every OS, because the app isn't code-signed.

| Platform | Download | First-launch step |
| --- | --- | --- |
| **macOS** — Apple Silicon | `Git Gud-<version>-arm64.dmg` | [Clear the quarantine flag](/install/macos) |
| **macOS** — Intel | `Git Gud-<version>-x64.dmg` | [Clear the quarantine flag](/install/macos) |
| **Windows** — x64 | `Git Gud Setup <version>.exe` | [Dismiss SmartScreen](/install/windows) |
| **Linux** — x64 | `Git Gud-<version>.AppImage` | [Mark it executable](/install/linux) |

Prefer to compile it yourself? See [build from source](/install/build-from-source) —
a locally built app skips every warning below.

## Why your OS complains

Code-signing certificates cost money per year: an Apple Developer ID for macOS,
an OV/EV certificate for Windows. Git Gud is a personal project and buys neither,
so both operating systems treat it as software from an unknown publisher.

That is the entire problem. Specifically:

- The app is **ad-hoc signed** on macOS (`identity: null` in `electron-builder.yml`) —
  a valid signature, just not one tied to a paid Apple identity.
- Your browser stamps every download with a quarantine flag (macOS) or a
  zone marker (Windows), and the OS refuses anything unknown carrying that flag.

Nothing is broken or corrupt. macOS phrases it as *"Git Gud is damaged and can't
be opened"*, which reads far worse than what's happening: it saw a downloaded app
without a paid signature and stopped. Clearing the flag once per machine is all
it takes.

::: tip Verify what you're running
Everything is built in the open by
[GitHub Actions](https://github.com/joe-lloyd/git-gud/blob/main/.github/workflows/release.yml)
from a tagged commit — the workflow log for each release shows exactly which
source produced the binaries. If you'd rather not trust a download at all,
[build it yourself](/install/build-from-source); it takes about two minutes.
:::

## Sending this to a colleague

Send them this page rather than the raw `.dmg`. The download on its own
produces the "damaged" dialog with no explanation, which is how most people
conclude the file is broken and give up.

## What Git Gud needs

- **Git installed** and on your `PATH` — the app drives the real `git` binary
  rather than reimplementing it. Check with `git --version`.
- **macOS 11+**, **Windows 10+**, or a **glibc-based Linux** (Ubuntu 20.04+ and
  friends).
- Nothing else. There's no account, no telemetry, and no background service.
