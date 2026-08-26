# gitgud-headless — Git Gud without a window

A small Linux daemon that serves your repositories to paired Git Gud GUIs
using the same peer protocol the desktop app uses (HTTPS + pinned
self-signed TLS, 6-digit pairing, SSE live updates). Pair once, then drive
that machine's repos — graph, working tree, fetch/pull/push, staging,
commits — from any Git Gud on your network or tailnet.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/joe-lloyd/git-gud/main/scripts/install-headless.sh | bash
gitgud-headless init --repo /srv/git/blog --repo ~/src/app   # writes ~/.config/gitgud-headless/config.jsonc
systemctl --user enable --now gitgud-headless
loginctl enable-linger "$USER"                              # keep it running after you log out
```

Requirements: Node ≥ 20, git. The install script verifies the sha256 and
installs the systemd user unit (`resources/gitgud-headless.service`).

## Pair a GUI

```sh
gitgud-headless pair          # prints a 6-digit code + certificate fingerprint, valid 10 min
gitgud-headless pair --qr     # same, plus a QR for the companion app
```

In Git Gud: **Peers → Connect by address** → the address printed (LAN IP,
`hostname`, or its Tailscale name) → compare the fingerprint → enter the
code. Pairing is *closed* until you run `pair`; one code = one pairing.

## Config (`config.jsonc`)

| Key | Default | Notes |
| --- | --- | --- |
| `name` | hostname | Shown in the GUI |
| `port` | 47831 | |
| `bind` | `127.0.0.1` | IP or interface name (`tailscale0`, `eth0`). Loopback = SSH tunnel only |
| `discovery` | false | LAN beacon (UDP 47832) so the GUI's *Nearby* list shows it |
| `readOnly` | **true** | Flip to `false` to allow writes. A paired GUI is then your shell in those working trees |
| `repos` | `[]` | Absolute paths to serve |
| `scanRoots` | `[]` | `{ "path": "/home/me/src", "depth": 2 }` — folders to scan for repos |
| `allowPeerIds` | `[]` | Only these Git Gud peer ids may pair |
| `denyMethods` | `["setConfig","writeFileContent"]` | Refused even when writable (both can execute code here) |
| `pairingWindowMinutes` | 10 | |
| `push` | false | Expo push for companion devices (opt-in) |
| `allowSourceCidrs` | `[]` | Only accept TCP from these networks, e.g. `["100.64.0.0/10"]` for your tailnet. Enforced before parsing |
| `infoPublic` | true | `false` → unauthenticated `/info` reveals only protocol + fingerprint |
| `tokenTtlDays` | 0 | Bearer tokens expire after N days; Git Gud clients rotate automatically (`__rotateToken`) when < 7 days remain |
| `heartbeatSeconds` | 15 | SSE keep-alive (5–60) |
| `allowWritesOnPublicBind` | false | A public bind (not loopback / RFC1918 / tailnet) **forces read-only** unless this is true |

Reload after editing: `gitgud-headless reload` (or `systemctl --user reload gitgud-headless`).

## Day to day

```sh
gitgud-headless status        # bind, repos, paired devices, pairing window
gitgud-headless devices       # paired devices, read-only flag, last seen
gitgud-headless revoke 1a2b3c4d
gitgud-headless audit -n 100  # JSONL trail: pairings, writes, revocations
gitgud-headless update        # self-update from GitHub Releases (--channel dev for pre-releases)
gitgud-headless tls show      # certificate fingerprint
gitgud-headless tls rotate --yes   # new certificate — every paired device must pair again
```

Files: config `~/.config/gitgud-headless/`, identity + TLS key + paired
devices `~/.local/share/gitgud-headless/` (0700), audit
`~/.local/state/gitgud-headless/audit.log`, control socket in
`$XDG_RUNTIME_DIR/gitgud-headless/`. `GITGUD_HEADLESS_HOME=/dir` puts
everything under one folder (several daemons on one box, tests).

## Reaching it from another building

Put both machines on a Tailscale tailnet, set `"bind": "tailscale0"`, and
connect by its MagicDNS name. Or keep `127.0.0.1` and tunnel:
`ssh -N -L 47831:127.0.0.1:47831 box` → connect by address `127.0.0.1`.
Do not port-forward 47831 on your router.

## Exposing it directly (port-forward) — only after reading this

Prefer Tailscale or an SSH tunnel. If you must forward the port: bind to the
public interface, set `allowSourceCidrs` to the networks you connect from,
`infoPublic: false`, `tokenTtlDays: 90`, keep `readOnly: true` (the daemon
forces it on a public bind anyway unless `allowWritesOnPublicBind` is set),
and add `IPAddressAllow=`/`IPAddressDeny=any` to the systemd unit. Pairing
attempts and every write land in `audit.log` with the source IP; the pairing
endpoint locks out for 1 → 2 → 4 … 60 minutes on repeated failures.

## Security notes

- TLS key and token hashes are owner-only; the daemon tightens permissions
  if it finds them loose. Never run it as root.
- Read-only by default; `denyMethods` blocks the two writes that can lead
  to arbitrary execution even when writable.
- The systemd unit uses `ProtectHome=read-only`; when you set
  `readOnly: false`, add your repo folders to `ReadWritePaths=`.
