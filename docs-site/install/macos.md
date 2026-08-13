---
title: 'Install on macOS'
description: 'Install Git Gud on macOS and clear the "app is damaged" Gatekeeper warning that unsigned downloads trigger.'
---

# Install on macOS

One command, or three manual steps — both end in the same place.

## Fastest: one command

```bash
curl -fsSL https://raw.githubusercontent.com/joe-lloyd/git-gud/main/scripts/install-macos.sh | bash
```

That downloads the right build for your Mac (Apple Silicon or Intel), verifies
its checksum, installs it into `/Applications`, and opens it. No "damaged"
dialog, ever — the quarantine flag that triggers it is added by *browsers*, and
`curl` doesn't set one. It's the same trick the
[in-app updater](/install/updating) uses, which is why updates never prompt
either. ([Read the script](https://github.com/joe-lloyd/git-gud/blob/main/scripts/install-macos.sh)
before piping it to bash if you like — it's short.)

Prefer clicking things? The manual route:

## 1. Pick the right build

Two DMGs ship per release. If you grab the wrong one the app still runs — under
Rosetta translation, slower and using more memory — so it's worth checking:

```bash
uname -m
```

| Output | Download |
| --- | --- |
| `arm64` | `Git Gud-<version>-arm64.dmg` — Apple Silicon (M1 – M4) |
| `x86_64` | `Git Gud-<version>-x64.dmg` — Intel Macs |

[Get them from the latest release →](https://github.com/joe-lloyd/git-gud/releases/latest)

## 2. Install it

Open the DMG and drag **Git Gud** onto the **Applications** shortcut, then eject
the DMG.

::: warning Don't run it from Downloads
macOS *app translocation* runs apps launched from `~/Downloads` out of a
randomised read-only path, which breaks the quarantine fix below. Move it to
`/Applications` first.
:::

## 3. Clear the quarantine flag

Double-clicking now gives you:

> **"Git Gud" is damaged and can't be opened. You should move it to the Bin.**

It is not damaged — see [why your OS complains](/install/#why-your-os-complains).
Pick either route.

### Terminal — one command, always works

```bash
xattr -dr com.apple.quarantine "/Applications/Git Gud.app"
```

Then open the app normally. That's it — the flag never comes back for this copy.

<details>
<summary>What that command actually does</summary>

`xattr` edits extended attributes — metadata macOS attaches to files.
`com.apple.quarantine` is the one your browser sets on every download, and it's
what makes Gatekeeper check an app before its first launch. `-d` deletes that
attribute, `-r` recurses through the `.app` bundle.

It changes nothing else: not the app, not the OS, not Gatekeeper's behaviour for
any other file. It's a per-file "I know where this came from" acknowledgement,
so only run it on downloads you actually trust.

</details>

### System Settings — no Terminal

1. Double-click Git Gud and dismiss the "damaged" dialog.
2. Open the **Apple menu** → **System Settings** → **Privacy & Security**.
3. Scroll to the **Security** section. Within a few minutes of the failed
   launch there's a line reading *"Git Gud" was blocked…* with an
   **Open Anyway** button. Click it and authenticate.
4. Confirm **Open** on the final dialog.

::: tip Right-click → Open doesn't work here
That trick downgrades the *"unidentified developer"* block, not the *"damaged"*
one. Recent macOS releases route this app down the second path, so use one of
the two routes above.
:::

## Confirm it worked

```bash
xattr -p com.apple.quarantine "/Applications/Git Gud.app"
# → xattr: ... No such xattr: com.apple.quarantine
```

That error *is* the success case: no quarantine attribute left to print. And
yes — `spctl -a -vv "/Applications/Git Gud.app"` will still say **rejected**.
That's `spctl` reporting the app has no paid Developer ID, which is true and
expected; it doesn't stop the app launching, because with the flag gone
Gatekeeper never runs that check on open.

## Still won't open?

| Symptom | Cause | Fix |
| --- | --- | --- |
| "damaged" returns after re-downloading | Each new download gets its own quarantine flag | Re-run the `xattr` command on the new copy |
| Fix appears to do nothing | App is being launched from `~/Downloads` (translocation) | Move it to `/Applications`, then re-run |
| "You do not have permission" | App was copied with `sudo`, so it's root-owned | `sudo xattr -dr com.apple.quarantine "/Applications/Git Gud.app"` |
| Opens, but shows a git error | `git` isn't on the `PATH` GUI apps inherit | Install the Xcode command line tools: `xcode-select --install` |
| Wrong-architecture warnings | Intel build on Apple Silicon | Re-download the `arm64` DMG |

## You only do this once

Updates are handled in-app, and they don't go through your browser — so the
replacement bundle never gets a quarantine flag and macOS never prompts again.
Git Gud checks for a new release a few seconds after launch, downloads it in the
background, and swaps it in when you restart. [How updating works →](/install/updating)

## Uninstalling

Drag the app to the Bin, then remove its data if you want a clean slate:

```bash
rm -rf ~/Library/Application\ Support/Git\ Gud
rm -rf ~/Library/Logs/Git\ Gud
rm -f  ~/Library/Preferences/com.joelloyd.gitgud.plist
```

Your repositories are untouched — Git Gud only ever reads and writes the git
repos you point it at.
