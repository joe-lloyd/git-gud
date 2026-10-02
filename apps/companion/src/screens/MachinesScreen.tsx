import React, { useCallback, useEffect, useState } from 'react'
import { FlatList, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Badge, Button, Card, Dot, Empty, Hint, Mono, Screen, Title } from '../ui/atoms'
import { theme } from '../ui/theme'
import { useAppState } from '../state/AppState'
import type { RootStack } from '../navigation'
import { withRelay } from '../net/peerClient'
import { FORGE_FEATURE } from '@gitgud/peer-protocol'
import { useApkUpdate, versionLabel, type UpdateState } from '../updates'

// Machines: every paired host, live reachability, repo count.
export const MachinesScreen: React.FC<NativeStackScreenProps<RootStack, 'Machines'>> = ({ navigation }) => {
  const { machines, client, updateMachine } = useAppState()
  const [status, setStatus] = useState<Record<string, { state: 'connected' | 'offline' | 'connecting' | 'revoked'; repos?: number; error?: string }>>({})
  const upd = useApkUpdate()

  const refresh = useCallback(async () => {
    if (!client) return
    for (const m of machines) {
      setStatus((s) => ({ ...s, [m.peerId]: { state: 'connecting' } }))
      try {
        const { address, info } = await client.probeAny(m.addresses, m.fingerprint)
        if (address.host !== m.lastGood?.host || address.port !== m.lastGood?.port) await updateMachine(m.peerId, { lastGood: address })
        // A forge can be configured (or removed) on the host at any time.
        const features = info.features ?? []
        if (JSON.stringify(features) !== JSON.stringify(m.features ?? [])) await updateMachine(m.peerId, { features })
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
        ListHeaderComponent={<>{machines.filter((m) => m.features?.includes(FORGE_FEATURE)).map((m) => (
          <Card key={`pulls-${m.peerId}`} onPress={() => navigation.navigate('Pulls', { peerId: m.peerId })} style={{ borderColor: theme.accentBorder }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Title>Pull requests</Title>
              <View style={{ flex: 1 }} />
              <Text style={{ color: theme.textMuted, fontSize: 12 }}>via {m.name} ›</Text>
            </View>
            <Hint>Review open pull requests on the forge {m.name} is connected to.</Hint>
          </Card>
        ))}</>}
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
                <Mono>{(m.lastGood ?? m.addresses[0]).relay ? `via relay ${(m.lastGood ?? m.addresses[0]).relay!.host}` : `${(m.lastGood ?? m.addresses[0]).host}:${(m.lastGood ?? m.addresses[0]).port}`}</Mono>
                {!!m.addresses.find((a) => a.relay) && !(m.lastGood ?? m.addresses[0]).relay && <Badge label="reachable anywhere" color={theme.green} />}
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
            <Mono>{versionLabel()}</Mono>
            {upd.state.kind !== 'unsupported' && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Button {...updateButton(upd.state, upd.check, upd.update)} />
              <View style={{ flex: 1 }}><Hint>{updateHint(upd.state)}</Hint></View>
            </View>}
          </View></View>}
      />
    </Screen>
  )
}

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`

function updateButton(s: UpdateState, check: () => void, update: () => void): { label: string; onPress: () => void; primary?: boolean; disabled?: boolean } {
  switch (s.kind) {
    case 'unsupported': case 'current': return { label: 'Check for updates', onPress: check }
    case 'checking': return { label: 'Checking…', onPress: check, disabled: true }
    case 'available': return { label: `Update to ${s.release.tag}`, onPress: update, primary: true }
    case 'downloading': return { label: `Downloading ${Math.round(s.progress * 100)}%`, onPress: update, disabled: true }
    case 'installing': return { label: 'Installing…', onPress: update, disabled: true }
    case 'error': return s.release ? { label: 'Retry update', onPress: update, primary: true } : { label: 'Check for updates', onPress: check }
  }
}

function updateHint(s: UpdateState): string {
  switch (s.kind) {
    case 'unsupported': case 'checking': return ''
    case 'current': return 'Up to date.'
    case 'available': return `${mb(s.release.size)} download. Android asks you to confirm the install.`
    case 'downloading': return `${mb(s.release.size * s.progress)} of ${mb(s.release.size)}`
    case 'installing': return 'Confirm in the Android installer. The app restarts on the new version.'
    case 'error': return s.message
  }
}
