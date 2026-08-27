import React, { useCallback, useEffect, useState } from 'react'
import { FlatList, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Badge, Button, Card, Dot, Empty, Hint, Mono, Screen, Title } from '../ui/atoms'
import { theme } from '../ui/theme'
import { useAppState } from '../state/AppState'
import type { RootStack } from '../navigation'
import { checkForUpdate, promptReload, versionInfo, versionLabel, type UpdateStatus } from '../updates'

// Machines: every paired host, live reachability, repo count.
export const MachinesScreen: React.FC<NativeStackScreenProps<RootStack, 'Machines'>> = ({ navigation }) => {
  const { machines, client, updateMachine } = useAppState()
  const [status, setStatus] = useState<Record<string, { state: 'connected' | 'offline' | 'connecting' | 'revoked'; repos?: number; error?: string }>>({})
  const [upd, setUpd] = useState<{ status: UpdateStatus; error?: string }>({ status: 'idle' })
  const v = versionInfo()
  const checkUpdates = async () => { setUpd({ status: 'checking' }); const r = await checkForUpdate(); setUpd(r); if (r.status === 'ready') promptReload() }

  const refresh = useCallback(async () => {
    if (!client) return
    for (const m of machines) {
      setStatus((s) => ({ ...s, [m.peerId]: { state: 'connecting' } }))
      try {
        const { address } = await client.probeAny(m.addresses, m.fingerprint)
        if (address.host !== m.lastGood?.host || address.port !== m.lastGood?.port) await updateMachine(m.peerId, { lastGood: address })
        const repos = await client.listRepos({ ...m, lastGood: address })
        // Scopes can change on the host at any time — refresh on every check.
        const me = await client.whoami({ ...m, lastGood: address }).catch(() => null)
        if (me && JSON.stringify(me.scopes ?? []) !== JSON.stringify(m.scopes ?? [])) await updateMachine(m.peerId, { scopes: me.scopes ?? [] })
        setStatus((s) => ({ ...s, [m.peerId]: { state: 'connected', repos: repos.length } }))
      } catch (e) {
        const code = (e as { code?: string }).code
        setStatus((s) => ({ ...s, [m.peerId]: { state: code === 'unauthorized' ? 'revoked' : 'offline', error: String((e as Error).message) } }))
      }
    }
  }, [client, machines, updateMachine])
  useEffect(() => { refresh() }, [refresh])

  return (
    <Screen>
      <FlatList
        data={machines}
        keyExtractor={(m) => m.peerId}
        ListEmptyComponent={<Empty>No machines yet. On your computer open Git Gud → Settings → Share with other Git Gud instances → Show QR, then scan it here.</Empty>}
        renderItem={({ item: m }) => {
          const st = status[m.peerId]
          return (
            <Card onPress={() => navigation.navigate('Repos', { peerId: m.peerId })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Dot status={st?.state ?? 'offline'} />
                <Title>{m.name}</Title>
                <View style={{ flex: 1 }} />
                {m.readOnly && <Badge label="read-only" color={theme.cyan} />}
                {m.platform === 'linux-headless' && <Badge label="daemon" />}
              </View>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
                <Mono>{(m.lastGood ?? m.addresses[0]).host}:{(m.lastGood ?? m.addresses[0]).port}</Mono>
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>{st?.state === 'connected' ? `${st.repos} repos` : st?.state === 'revoked' ? 'access revoked on host' : st?.state === 'connecting' ? 'connecting…' : 'offline'}</Text>
              </View>
              {st?.error && st.state !== 'connected' && <Hint>{st.error}</Hint>}
            </Card>
          )
        }}
        onRefresh={refresh}
        refreshing={false}
        ListFooterComponent={<View style={{ padding: 12, gap: 8 }}><Button primary label="Pair a machine (scan QR)" onPress={() => navigation.navigate('Pair')} /><Hint>Read-only by design: the phone can see history, working trees and diffs on the machines it is paired with and never runs writes. Revoke it any time from the host's Settings → Paired devices.</Hint>
          <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 12, gap: 6 }}>
            <Mono>{versionLabel(v)}</Mono>
            {v.runtimeVersion && <Hint>runtime {v.runtimeVersion}{v.channel ? ` · channel ${v.channel}` : ''}{v.updateId ? ` · update ${v.updateId.slice(0, 8)}` : ''}</Hint>}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Button label={upd.status === 'checking' ? 'Checking…' : upd.status === 'downloading' ? 'Downloading…' : 'Check for updates'} disabled={upd.status === 'checking' || !v.otaEnabled} onPress={checkUpdates} />
              <Hint>{!v.otaEnabled ? 'OTA updates are off in this build — updates ship as new APKs.' : upd.status === 'up-to-date' ? 'Up to date.' : upd.status === 'ready' ? 'Update downloaded — restart to apply.' : upd.status === 'error' ? `Update check failed: ${upd.error ?? ''}` : 'JS updates install without a new APK; native changes still need one.'}</Hint>
            </View>
          </View></View>}
      />
    </Screen>
  )
}
