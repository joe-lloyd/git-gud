// Over-the-air JS updates (expo-updates) + a single place that knows *what*
// is running: native build version, embedded vs downloaded JS, and the
// release tag / commit the JS came from (stamped into app.json by CI).
import { useEffect, useState } from 'react'
import { Alert, AppState } from 'react-native'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'

export interface VersionInfo {
  appVersion: string            // native build version (APK), e.g. 1.14.2
  jsTag: string                 // release tag the JS was built from (CI stamp) or 'dev'
  jsSha: string                 // short commit sha (CI stamp) or ''
  runtimeVersion: string | null // expo-updates runtime (fingerprint) the JS requires
  source: 'embedded' | 'update' | 'dev'
  updateId: string | null
  updatedAt: Date | null
  channel: string | null
  otaEnabled: boolean
}

export function versionInfo(): VersionInfo {
  const extra = (Constants.expoConfig?.extra ?? {}) as { build?: { tag?: string; sha?: string } }
  return {
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
    jsTag: extra.build?.tag ?? 'dev',
    jsSha: extra.build?.sha?.slice(0, 7) ?? '',
    runtimeVersion: Updates.runtimeVersion ?? null,
    source: __DEV__ ? 'dev' : Updates.isEmbeddedLaunch ? 'embedded' : 'update',
    updateId: Updates.updateId ?? null,
    updatedAt: Updates.createdAt ?? null,
    channel: Updates.channel ?? null,
    otaEnabled: Updates.isEnabled,
  }
}

/** "1.14.2 · js v1.14.3 (abc1234, OTA 27 Aug 11:02)" — always shows both halves so every version is traceable. */
export function versionLabel(v: VersionInfo = versionInfo()): string {
  const js = `${v.jsTag}${v.jsSha ? ` ${v.jsSha}` : ''}`
  const how = v.source === 'dev' ? 'dev server' : v.source === 'embedded' ? 'built in' : `OTA${v.updatedAt ? ` ${v.updatedAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${v.updatedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}`
  return `App ${v.appVersion} · JS ${js} (${how})`
}

export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'disabled' | 'error'

/** Check for an OTA update; on success the caller decides when to reload. Never throws. */
export async function checkForUpdate(): Promise<{ status: UpdateStatus; error?: string }> {
  if (!Updates.isEnabled || __DEV__) return { status: 'disabled' }
  try {
    const r = await Updates.checkForUpdateAsync()
    if (!r.isAvailable) return { status: 'up-to-date' }
    await Updates.fetchUpdateAsync()
    return { status: 'ready' }
  } catch (e) { return { status: 'error', error: String((e as Error).message ?? e) } }
}

export function promptReload(): void {
  Alert.alert('Update ready', 'A new version of the companion app was downloaded. Restart now?', [
    { text: 'Later', style: 'cancel' },
    { text: 'Restart', onPress: () => { Updates.reloadAsync().catch(() => {}) } },
  ])
}

/** Auto-update: check on launch and whenever the app returns to the foreground (at most every 10 min). */
export function useAutoUpdate(): { status: UpdateStatus; error?: string; check: () => Promise<void> } {
  const [state, setState] = useState<{ status: UpdateStatus; error?: string }>({ status: Updates.isEnabled && !__DEV__ ? 'idle' : 'disabled' })
  const check = async () => {
    if (state.status === 'checking' || state.status === 'downloading') return
    setState({ status: 'checking' })
    const r = await checkForUpdate()
    setState(r)
    if (r.status === 'ready') promptReload()
  }
  useEffect(() => {
    let last = 0
    const run = () => { if (Date.now() - last > 10 * 60_000) { last = Date.now(); check() } }
    run()
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') run() })
    return () => sub.remove()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, check }
}
