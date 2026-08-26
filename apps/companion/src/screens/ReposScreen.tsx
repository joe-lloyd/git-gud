import React, { useCallback, useEffect, useState } from 'react'
import { Alert, FlatList, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { PeerRepoSummary } from '@gitgud/peer-protocol'
import { Badge, Button, Card, Empty, Hint, Loading, Mono, Screen, Title } from '../ui/atoms'
import { theme } from '../ui/theme'
import { useAppState } from '../state/AppState'
import type { RootStack } from '../navigation'

type RepoStatus = { branch: string; ahead: number; behind: number; staged: unknown[]; unstaged: unknown[]; untracked: unknown[] }

export const ReposScreen: React.FC<NativeStackScreenProps<RootStack, 'Repos'>> = ({ navigation, route }) => {
  const { machines, client, removeMachine } = useAppState()
  const m = machines.find((x) => x.peerId === route.params.peerId)
  const [repos, setRepos] = useState<PeerRepoSummary[] | null>(null)
  const [status, setStatus] = useState<Record<string, RepoStatus>>({})
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!client || !m) return
    try {
      const list = await client.listRepos(m)
      setRepos(list); setError('')
      for (const r of list) client.rpc<RepoStatus>(m, r.path, 'getStatus').then((s) => setStatus((x) => ({ ...x, [r.path]: s }))).catch(() => {})
    } catch (e) { setError(String((e as Error).message)) }
  }, [client, m])
  useEffect(() => { navigation.setOptions({ title: m?.name ?? 'Repos' }); load() }, [load, m?.name, navigation])

  if (!m) return <Screen><Empty>Machine not found.</Empty></Screen>
  return (
    <Screen>
      {repos === null && !error && <Loading label={`Asking ${m.name} for its repositories…`} />}
      {error && <Card><Text style={{ color: theme.red }}>{error}</Text><View style={{ height: 8 }} /><Button label="Retry" onPress={load} /></Card>}
      <FlatList
        data={repos ?? []}
        keyExtractor={(r) => r.path}
        onRefresh={load} refreshing={false}
        ListEmptyComponent={repos && <Empty>{m.name} shares no repositories. Open one there (or add it to the daemon's config).</Empty>}
        renderItem={({ item: r }) => {
          const s = status[r.path]
          const dirty = s ? s.staged.length + s.unstaged.length + s.untracked.length : 0
          return (
            <Card onPress={() => navigation.navigate('Repo', { peerId: m.peerId, repoPath: r.path, name: r.name })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Title>{r.name}</Title>
                {r.open && <Badge label="open" color={theme.green} />}
                <View style={{ flex: 1 }} />
                {s && <Mono color={theme.accent}>{s.branch}</Mono>}
              </View>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
                <Mono>{r.path}</Mono>
              </View>
              {s && (
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
                  <Text style={{ color: dirty ? theme.yellow : theme.textMuted, fontSize: 12 }}>{dirty ? `${dirty} changed` : 'clean'}</Text>
                  {s.ahead > 0 && <Text style={{ color: theme.green, fontSize: 12 }}>↑{s.ahead}</Text>}
                  {s.behind > 0 && <Text style={{ color: theme.cyan, fontSize: 12 }}>↓{s.behind}</Text>}
                </View>
              )}
            </Card>
          )
        }}
        ListFooterComponent={<View style={{ padding: 12, gap: 8 }}>
          <Hint>{m.name} · {m.platform} · Git Gud {m.version} · pinned {m.fingerprint.replace(/:/g, '').slice(0, 16)}</Hint>
          <Button label="Forget this machine" onPress={() => Alert.alert('Forget machine?', 'Removes it from this phone. Also revoke the phone on the host to invalidate the token.', [{ text: 'Cancel' }, { text: 'Forget', style: 'destructive', onPress: () => removeMachine(m.peerId).then(() => navigation.popToTop()) }])} />
        </View>}
      />
    </Screen>
  )
}
