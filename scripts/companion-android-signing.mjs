// Patches the Expo-generated android/app/build.gradle so release builds use a
// real keystore when the workflow provides one. Without the env vars the
// template's public debug.keystore is left in place (see README → Companion
// app). Idempotent; run after `expo prebuild`.
//
//   COMPANION_KEYSTORE_FILE=release.keystore COMPANION_KEYSTORE_PASSWORD=… \
//   COMPANION_KEY_ALIAS=… COMPANION_KEY_PASSWORD=… node scripts/companion-android-signing.mjs apps/companion/android/app/build.gradle
import { readFileSync, writeFileSync } from 'node:fs'

const gradlePath = process.argv[2]
if (!gradlePath) { console.error('usage: companion-android-signing.mjs <path/to/app/build.gradle>'); process.exit(2) }
const { COMPANION_KEYSTORE_FILE, COMPANION_KEYSTORE_PASSWORD, COMPANION_KEY_ALIAS, COMPANION_KEY_PASSWORD } = process.env
if (!COMPANION_KEYSTORE_FILE || !COMPANION_KEYSTORE_PASSWORD || !COMPANION_KEY_ALIAS || !COMPANION_KEY_PASSWORD) {
  console.log('[signing] no release keystore configured — keeping the template debug.keystore')
  process.exit(0)
}
let gradle = readFileSync(gradlePath, 'utf8')
if (gradle.includes('signingConfigs.release')) { console.log('[signing] already patched'); process.exit(0) }
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const releaseBlock = `        release {
            storeFile file('${esc(COMPANION_KEYSTORE_FILE)}')
            storePassword '${esc(COMPANION_KEYSTORE_PASSWORD)}'
            keyAlias '${esc(COMPANION_KEY_ALIAS)}'
            keyPassword '${esc(COMPANION_KEY_PASSWORD)}'
        }
`
const before = gradle
gradle = gradle.replace(/(    signingConfigs \{\n)/, `$1${releaseBlock}`)
gradle = gradle.replace(/(        release \{[^}]*?)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.release')
if (gradle === before || !gradle.includes('signingConfigs.release')) { console.error('[signing] could not find the expected gradle blocks'); process.exit(1) }
writeFileSync(gradlePath, gradle)
console.log('[signing] release build now signed with', COMPANION_KEYSTORE_FILE)
