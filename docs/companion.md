# Git Gud companion app (read-only, Expo)

`apps/companion` — a React Native / Expo app that pairs with your Git Gud
hosts (desktop or `gitgud-headless`) as a **read-only device** and shows
Machines → Repos → commit graph → working tree → diffs, live over SSE while a
repo screen is open, with optional push notifications when a repo changes.

## Why read-only
The phone never sends a `WRITE_METHODS` call: the client refuses them before
the wire (`peerClient.ts`) and the host refuses them again (`PairedDevice.readOnly`,
set automatically because the phone pairs with `kind: "companion"`). A lost
phone can read your diffs until you revoke it — Settings → Paired devices →
Revoke on each host — and nothing more.

## Pairing
Desktop: Settings → *Share with other Git Gud instances* → **Show QR**.
Daemon: `gitgud-headless pair --qr`. The QR carries address(es), the host's
certificate fingerprint and the one-time code; the phone **pins the
certificate before its first request**, so there is no trust-on-first-use
window and nothing to type.

## Certificate pinning on mobile
Hosts use self-signed certificates, which the OS trust store rejects. The
`modules/pinned-fetch` Expo module (Swift `URLSession` delegate / Kotlin OkHttp
`X509TrustManager`) accepts a connection **iff** SHA-256(leaf DER) equals the
pinned fingerprint — the same string the desktop shows. It also streams SSE.
Requires a dev/EAS build (not Expo Go). Expo web falls back to plain fetch
with no pinning — development only.

## Build & run
```sh
cd apps/companion
pnpm exec expo prebuild            # generates ios/ android/ with the pinned-fetch module
pnpm exec expo run:android         # or run:ios on a Mac with Xcode
# or: eas build --profile preview --platform android   (APK to sideload)
```
Reachability: same LAN, or Tailscale on the phone (the QR includes the
machine's hostname; add the tailnet name to `alts` by pairing while on it).

## Push notifications
Opt-in per host (Settings → *Notify phones on changes*, or `"push": true` in
the daemon config). The host POSTs `{machine, repo, kind}` to Expo's push
API — metadata only, never content — debounced 30 s per repo. Needs an Expo
account/project id for production tokens.

## Dependency policy note
The desktop keeps its zero-new-runtime-dependency rule. The phone is a
separate workspace with a small, pinned Expo module set (`expo-camera`,
`expo-secure-store`, `expo-notifications`, `expo-crypto`, `expo-device`,
`react-navigation`, `react-native-svg`). Installed with `--ignore-scripts`
and the 3-day `minimumReleaseAge` like everything else.
