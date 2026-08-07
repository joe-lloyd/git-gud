---
title: 'Install on Windows'
description: 'Install Git Gud on Windows and get past the SmartScreen warning that unsigned installers trigger.'
---

# Install on Windows

## 1. Download

Grab `Git Gud Setup <version>.exe` from the
[latest release](https://github.com/joe-lloyd/git-gud/releases/latest). It's a
64-bit build; there's no 32-bit or ARM installer.

## 2. Get past SmartScreen

Running the installer shows:

> **Windows protected your PC**
> Microsoft Defender SmartScreen prevented an unrecognised app from starting.

That's the unsigned-binary warning — see
[why your OS complains](/install/#why-your-os-complains). To continue:

1. Click **More info** (the small link under the message — the dialog hides the
   button until you do).
2. Click **Run anyway**.

<details>
<summary>Prefer to clear the marker first</summary>

Windows records the download in an alternate data stream called *Zone.Identifier*.
Strip it and SmartScreen never asks:

```powershell
Unblock-File -Path "$HOME\Downloads\Git Gud Setup 1.4.1.exe"
```

Same thing via the GUI: right-click the `.exe` → **Properties** → tick
**Unblock** at the bottom of the General tab → **OK**.

Only do this for downloads whose origin you know — the marker exists precisely
so the OS can be careful about the ones you don't.

</details>

## 3. Install

The installer is per-user and **doesn't need admin rights**. It asks where to
install; the default under `%LOCALAPPDATA%\Programs` is fine. It creates Start
menu and desktop shortcuts.

## Requirements

Git must be installed and on your `PATH` — Git Gud drives the real `git`
binary. Check in PowerShell:

```powershell
git --version
```

Nothing back? Install [Git for Windows](https://git-scm.com/download/win),
then restart Git Gud so it picks up the new `PATH`.

## Updating

Automatic. Git Gud checks GitHub Releases a few seconds after launch, downloads
in the background, and installs on quit. [Details →](/install/updating)

## Uninstalling

**Settings** → **Apps** → **Installed apps** → **Git Gud** → **Uninstall**.
To also drop its stored state (open tabs, recent repos, encrypted host tokens):

```powershell
Remove-Item -Recurse -Force "$env:APPDATA\Git Gud"
```

Your repositories are untouched.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| SmartScreen has no "Run anyway" | Your org enforces SmartScreen policy — ask IT, or [build from source](/install/build-from-source) |
| Antivirus quarantines the installer | Unsigned Electron installers are a common false positive; allow-list it or build from source |
| App opens but every git action errors | `git` isn't on the `PATH` — install Git for Windows and relaunch |
| Blank window on launch | Update your GPU driver, or launch with `--disable-gpu` |
