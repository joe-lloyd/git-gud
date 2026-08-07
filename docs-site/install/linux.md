---
title: 'Install on Linux'
description: 'Run the Git Gud AppImage on Linux, including the FUSE dependency and desktop integration.'
---

# Install on Linux

Linux ships as a single x64 **AppImage** — one self-contained file, no package
manager, no root.

## 1. Download and run

```bash
cd ~/Downloads
chmod +x "Git Gud-1.4.1.AppImage"
./"Git Gud-1.4.1.AppImage"
```

`chmod +x` is the whole install step: browsers drop the executable bit, and
AppImages need it back. Grab the file from the
[latest release](https://github.com/joe-lloyd/git-gud/releases/latest).

## 2. If it won't start

AppImages mount themselves with FUSE 2, which recent distros no longer install
by default:

```
dlopen(): error loading libfuse.so.2
```

Either install it —

```bash
sudo apt install libfuse2      # Debian / Ubuntu
sudo dnf install fuse-libs     # Fedora
sudo pacman -S fuse2           # Arch
```

— or skip FUSE entirely by extracting on each run:

```bash
./"Git Gud-1.4.1.AppImage" --appimage-extract-and-run
```

## Put it somewhere permanent

Nothing enforces where an AppImage lives, but leaving it in `~/Downloads` means
losing it on the next cleanup:

```bash
mkdir -p ~/Applications
mv "Git Gud-1.4.1.AppImage" ~/Applications/
```

For a menu entry and icon, install
[AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) — it
integrates any AppImage you open and keeps updates in one place.

## Requirements

- x86_64, glibc-based (Ubuntu 20.04+, Fedora 36+, Debian 11+ and equivalents).
  There's no ARM or musl build.
- `git` on your `PATH` — the app shells out to the real binary.
- A working desktop session; Electron needs X11 or Wayland with XWayland.

## Updating

Automatic. Git Gud checks GitHub Releases shortly after launch and replaces the
AppImage in place. [Details →](/install/updating)

## Uninstalling

Delete the AppImage, then its state if you want it gone completely:

```bash
rm -rf ~/.config/Git\ Gud
```

Your repositories are untouched.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Permission denied` | The executable bit is missing — `chmod +x` the file |
| `libfuse.so.2` error | Install FUSE 2 or use `--appimage-extract-and-run` |
| Sandbox / `SUID sandbox` error | Run with `--no-sandbox`, or enable unprivileged user namespaces: `sudo sysctl -w kernel.unprivileged_userns_clone=1` |
| Blank or black window | GPU driver issue — try `--disable-gpu` |
| Blurry text on HiDPI | Launch with `--force-device-scale-factor=2` |
