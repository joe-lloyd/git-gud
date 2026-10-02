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
| `forges` | `[]` | Forgejo/Gitea instances whose pull requests paired devices may read (see below) |

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

## Pull requests for the companion app

The companion can review pull requests on a Forgejo (or Gitea) instance
**through** the daemon: the daemon holds the token and calls the forge, and
the phone only ever sees the results over its pinned connection. Revoking the
phone on the daemon cuts its access to the forge too.

1. On the forge, create a token for this machine (Settings → Applications)
   with **read:repository, read:issue, read:user**. Nothing else is needed.
2. Save it where only you can read it. The daemon refuses a token file other
   users can read:
   ```sh
   (umask 077; pbpaste > ~/.config/gitgud-headless/forgejo-token)   # or paste with an editor
   ```
3. If the forge's certificate comes from a private CA (Caddy's local
   authority, for example), give the daemon that CA. Node does not use the
   macOS keychain, so this is required even when the browser and curl trust
   it:
   ```sh
   security find-certificate -c "Caddy Local Authority - 2026 ECC Root" -p > ~/.config/gitgud-headless/forge-ca.pem
   ```
4. Add the forge to `config.jsonc` and reload:
   ```jsonc
   "forges": [{
     "id": "home", "kind": "forgejo", "url": "https://git.home.arpa",
     "tokenFile": "~/.config/gitgud-headless/forgejo-token",
     "caFile": "~/.config/gitgud-headless/forge-ca.pem",
     "owners": []            // optional: only these owners/orgs in the inbox
   }]
   ```
   ```sh
   gitgud-headless reload && gitgud-headless forge check
   # ✓ home  https://git.home.arpa  as joe-lloyd  ·  4 open pull requests
   ```

On the phone, a **Pull requests** card appears on the Machines screen the
next time it refreshes. The inbox toggles between **All open** and **Needs
review** (open, not a draft, and no review from you on the latest commit).

Review bots are recognised by their status context. The default is JEV
(`jev/base-review`, with comment marker `<!-- jev-base-review -->`).
Override it per forge with `"bots": [{ "name", "context", "commentMarker" }]`.
Bot contexts are kept out of the belt (CI) rollup.

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
