// Self-update by full APK: ask GitHub Releases for a newer companion APK,
// download it, and hand it to Android's package installer. Android always
// shows its own "Update this app?" confirmation for a sideloaded APK; the
// first time it also asks to allow installs from Git Gud.
import { useCallback, useEffect, useState } from 'react'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as FileSystem from 'expo-file-system'
import * as IntentLauncher from 'expo-intent-launcher'
import { newerApk, parseReleases, type ApkRelease } from './apkRelease'

const RELEASES_URL = 'https://api.github.com/repos/joe-lloyd/git-gud/releases?per_page=30'
const FLAG_GRANT_READ_URI_PERMISSION = 1

export interface VersionInfo {
  appVersion: string // e.g. 1.20.1 (CI stamp) or 0.1.0 locally
  tag: string        // release tag the build came from, or 'dev'
  sha: string        // short commit sha, or ''
}

export function versionInfo(): VersionInfo {
  const extra = (Constants.expoConfig?.extra ?? {}) as { build?: { tag?: string; sha?: string } }
  return {
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
    tag: extra.build?.tag ?? 'dev',
    sha: extra.build?.sha?.slice(0, 7) ?? '',
  }
}

/** "Git Gud 1.20.1 (v1.20.1 abc1234)". */
export function versionLabel(v: VersionInfo = versionInfo()): string {
  return `Git Gud ${v.appVersion} (${v.tag}${v.sha ? ` ${v.sha}` : ''})`
}

export type UpdateState =
  | { kind: 'unsupported' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'available'; release: ApkRelease }
  | { kind: 'downloading'; release: ApkRelease; progress: number }
  | { kind: 'installing'; release: ApkRelease }
  | { kind: 'error'; message: string; release?: ApkRelease }

async function findUpdate(current: string): Promise<ApkRelease | null> {
  const res = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  return newerApk(parseReleases(await res.json()), current)
}

/** Checks on mount; `update()` downloads the APK and opens the installer. */
export function useApkUpdate(): { state: UpdateState; check: () => void; update: () => void } {
  const supported = Platform.OS === 'android'
  const [state, setState] = useState<UpdateState>(supported ? { kind: 'checking' } : { kind: 'unsupported' })

  const check = useCallback(() => {
    if (!supported) return
    setState({ kind: 'checking' })
    findUpdate(versionInfo().appVersion)
      .then((release) => setState(release ? { kind: 'available', release } : { kind: 'current' }))
      .catch((e: unknown) => setState({ kind: 'error', message: `Update check failed: ${(e as Error).message ?? e}` }))
  }, [supported])

  const install = useCallback(async (release: ApkRelease) => {
    const dir = `${FileSystem.cacheDirectory}apk/`
    try {
      // One APK at a time: clear earlier downloads (~100 MB each) first.
      await FileSystem.deleteAsync(dir, { idempotent: true })
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true })
      setState({ kind: 'downloading', release, progress: 0 })
      const task = FileSystem.createDownloadResumable(release.url, dir + release.name, {}, (p) => {
        const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : release.size
        setState({ kind: 'downloading', release, progress: total > 0 ? p.totalBytesWritten / total : 0 })
      })
      const done = await task.downloadAsync()
      if (!done || done.status !== 200) throw new Error(`download failed (HTTP ${done?.status ?? '?'})`)
      setState({ kind: 'installing', release })
      // Returns once the installer closes. On success Android replaces and
      // kills this process, so getting here means it was cancelled or failed.
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: await FileSystem.getContentUriAsync(done.uri),
        type: 'application/vnd.android.package-archive',
        flags: FLAG_GRANT_READ_URI_PERMISSION,
      })
      setState({ kind: 'available', release })
    } catch (e) {
      setState({ kind: 'error', message: `Update failed: ${(e as Error).message ?? e}`, release })
    }
  }, [])

  const update = useCallback(() => {
    const release = state.kind === 'available' || state.kind === 'error' ? state.release : undefined
    if (release) install(release)
  }, [state, install])

  useEffect(() => { check() }, [check])
  return { state, check, update }
}
