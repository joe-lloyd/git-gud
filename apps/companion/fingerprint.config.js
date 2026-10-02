// Runtime-version fingerprint for OTA updates (expo-updates, policy
// "fingerprint"). CI stamps app.json on every release with the version,
// versionCode, extra.build {tag, sha} and the EAS project id/url. None of that
// is native, but by default it all feeds the hash, so every release would get
// a new runtime version and no OTA update could ever reach an installed APK.
// Skip exactly those fields; native changes still change the fingerprint.
const { SourceSkips } = require('expo/fingerprint')

/** @type {import('expo/fingerprint').Config} */
module.exports = {
  sourceSkips:
    SourceSkips.ExpoConfigVersions |
    SourceSkips.ExpoConfigExtraSection |
    SourceSkips.ExpoConfigEASProject,
}
