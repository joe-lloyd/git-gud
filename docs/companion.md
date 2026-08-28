# Git Gud companion app (read-only, Expo)

`apps/companion` — a React Native / Expo app that pairs with your Git Gud
hosts (desktop or `gitgud-headless`) as a **read-only device** and shows
Machines → Repos → commit graph → working tree → diffs, live over SSE while a
repo screen is open, with optional push notifications when a repo changes.

## Why read-only (and the three writes that aren't)
The phone never sends a `WRITE_METHODS` call: the client refuses them before
the wire (`peerClient.ts`) and the host refuses them again (`PairedDevice.readOnly`,
set automatically because the phone pairs with `kind: "companion"`). A lost
phone can read your diffs until you revoke it — Settings → Paired devices →
Revoke on each host — and nothing more.

The host's owner can grant **scopes** per phone (Settings → Paired devices →
chips, or `gitgud-headless allow <id> fetch,pull,push`): the repo screen then
shows **Fetch**, **Pull ↓n** and **Push ↑n** buttons, each with a confirmation.
The host enforces the safe variants regardless of what the client sends
(`companionSafeArgs`): pull is `--ff-only` (refused instead of merging or
rebasing when the branch diverged), push is never forced. Nothing a phone can
do rewrites history.

## Reaching machines from anywhere
Same Wi-Fi works out of the box. From elsewhere the phone uses the machine's
**relay** (see `relay.md`): the route arrives with the pairing QR, or later
through `/gitgud/info` — Machines shows *reachable anywhere* once learned —
and is tried after the direct addresses. Android only for now (see relay.md).

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

## Updates: OTA JS vs. new APK
The app has two version halves, both shown at the bottom of **Machines**:
`App 1.14.2 · JS v1.14.3 abc1234 (OTA 27 Aug 11:02)`.

- **App** — the native build (APK). Changes only when you install a new APK
  (scan the QR on a release).
- **JS** — the bundle actually running: the release tag + commit it was built
  from, and whether it is the one *built in* to the APK or an *OTA* update.

OTA updates use `expo-updates` with the **fingerprint** runtime policy: a JS
update only applies to APKs whose native code (Expo SDK, native modules,
`pinned-fetch`) hashes the same — so a release that touched native code
simply won't reach old APKs over the air, and the footer tells you to
reinstall. The app checks on launch and on every return to the foreground
(≤ once per 10 min) and asks before restarting; **Check for updates** forces it.

Setup (one-time, needs an Expo account):
1. `cd apps/companion && pnpm dlx eas-cli@latest init` → note the project id.
2. Repo secrets: `EXPO_PROJECT_ID` (that id) and `EXPO_TOKEN`
   (https://expo.dev/accounts/<you>/settings/access-tokens).
3. Release as usual. CI stamps the id into `app.json`, builds the APK with OTA
   enabled, and runs `eas update --branch production` (`dev` for pre-release
   tags). Until the secrets exist the footer says *OTA updates are off in this
   build* and every release is APK-only.

## Safe areas
Android 15+ draws edge-to-edge (`edgeToEdgeEnabled: true`). The stack header
clears the status bar/cutout; every `Screen` pads by the bottom system inset
(`react-native-safe-area-context`), so buttons never sit under the gesture bar.
