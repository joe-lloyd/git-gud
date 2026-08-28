# gitgud-relay — reach your machines from anywhere without Tailscale

A tiny zero-dependency Node service you host (VPS, Azure Container App,
Raspberry Pi with a public port) that lets a Git Gud client behind one NAT
reach a Git Gud host behind another. **It never sees your data**: the host's
own certificate-pinned TLS is negotiated end to end *through* the relay; the
relay only forwards ciphertext.

Once a host has a relay, **every device that has ever paired with it can
reach it from anywhere** as long as the machine is on and Git Gud (or the
daemon) is running: the host advertises its route in `/gitgud/info`, clients
store it, try direct addresses first and fall back to the relay by themselves
— then go back to direct when they are on the LAN again. No re-pairing.

Two ways in, one splice:

* **Frame clients** (desktop Git Gud, hosts): TLS to the relay, then JSON
  frames (`register` / `connect` / `accept`).
* **SNI clients** (the phone, or any plain HTTPS client): connect to the
  relay with TLS server-name `<peerId>.gitgud-relay`. The relay reads the
  name from the ClientHello without terminating TLS and pipes the connection
  to that host, so the TLS session — and the certificate the phone pins — is
  the host's own.

```
GUI / phone ──TLS──▶ relay ◀──TLS── host (desktop or gitgud-headless)
             "connect peerId + sha256(fp)"        "register peerId + token + sha256(fp)"
                       └── splice ──┘   → inside: the host's pinned TLS + normal /gitgud/* traffic
```

## One-command deploy on Azure

```sh
az login
./deploy/relay/azure.sh          # Container App, public TCP 47833, Azure Files volume for /data
```
Prints `relay://<fqdn>:47833#<fingerprint>` plus the exact desktop/daemon
settings. The `/data` volume matters: it holds the relay's TLS key (its
fingerprint is what everyone pins) and the host-token bindings. Costs are a
0.25 vCPU app + a file share; egress is only what you actually transfer.

## Run it

```sh
# single file from GitHub Releases (Node ≥ 20)
curl -fsSL -o gitgud-relay https://github.com/joe-lloyd/git-gud/releases/latest/download/gitgud-relay-<version>.js
node gitgud-relay --port 47833            # prints:  relay listening … address=relay://host:47833#<fingerprint>
# or Docker / Azure Container Apps (TCP ingress on 47833):
docker build -f deploy/relay/Dockerfile -t gitgud-relay . && docker run -d -p 47833:47833 -v gitgud-relay:/data gitgud-relay
```

Keep the printed `relay://…#fingerprint` — that is what hosts and clients pin.

## Point a host at it

* Desktop: Settings → *Share with other Git Gud instances* → **Reachable via relay** → paste `relay://host:47833#fingerprint`.
* Daemon: `"rendezvous": { "url": "relay://host:47833#fingerprint", "token": "<any long random secret>" }` then `gitgud-headless reload`.

The host keeps one outbound connection registered (keep-alive every 25 s).
The first registration of a peer id binds its token at the relay; a
different token is refused (`gitgud-relay tokens` / `forget <peerId>`).

## Phones

The companion app needs no setup: when a machine it is paired with gains a
relay, the phone learns the route on its next check (Machines shows
*reachable anywhere*), and uses it whenever the direct addresses fail. New
pairings get the route from the QR. Android only for now — iOS `URLSession`
cannot connect to one address while sending another SNI, so iPhones reach
hosts directly or via Tailscale until the relay grows an HTTP CONNECT front.

## Pair from anywhere

Show the QR (desktop) or `gitgud-headless pair --qr`. The payload now carries
`r=relay://…/<peerId>#fp`. Paste it into **Connect by address** on the other
machine (or scan it with the companion app): direct addresses are tried
first, then the relay. Nothing to type; the certificate is pinned before the
first request.

## What the relay can and cannot do

| Can | Cannot |
| --- | --- |
| see which peer ids are online, their IPs, timing and byte counts | read or modify traffic (pinned TLS terminates on the host) |
| deny service | forge RPCs, pair (proof is bound to the real fingerprint), or discover peers (frame clients must present `sha256(fingerprint)`; SNI clients must know the 16-byte random peer id — the relay answers unknown names with its own certificate and nothing else) |

## Not yet: hole punching
This is relay-first: every remote connection flows through the relay. A
later phase can add a simultaneous-open attempt (both sides learn each
other's reflexive address from the relay and connect directly, falling back
to the splice). For a personal relay the extra latency (~one hop) is
negligible; egress cost is only the bytes you actually transfer.
