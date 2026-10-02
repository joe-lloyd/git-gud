import React, { useCallback, useEffect, useState } from 'react'
import { FlatList, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { PullList, PullSummary } from '@gitgud/peer-protocol'
import { Badge, Button, Card, Empty, Hint, Loading, Mono, Screen, Segmented } from '../ui/atoms'
import { theme } from '../ui/theme'
import { age, botLabel, checksLabel, stateColor } from '../ui/forge'
import { useAppState } from '../state/AppState'
import { loadFilter, loadViewed, pruneViewed, saveFilter, viewedKey, type PullFilter, type ViewedState } from '../state/viewed'
import type { RootStack } from '../navigation'

// Inbox: every open PR the host's forge token can see. The toggle is local —
// both lists come from one host call (needsReview is computed host-side).
export const PullsScreen: React.FC<NativeStackScreenProps<RootStack, 'Pulls'>> = ({ navigation, route }) => {
  const { machines, client } = useAppState()
  const m = machines.find((x) => x.peerId === route.params.peerId)
  const [list, setList] = useState<PullList | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<PullFilter>('all')
  const [viewed, setViewed] = useState<Record<string, ViewedState | null>>({})
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => { loadFilter().then(setFilter) }, [])
  const choose = (f: PullFilter) => { setFilter(f); saveFilter(f) }

  const load = useCallback(async () => {
    if (!client || !m) return
    setRefreshing(true)
    try {
      const l = await client.forgeListPulls(m)
      setList(l); setError('')
      const keys = l.pulls.map((p) => viewedKey(p.forge, p.repo, p.number))
      const entries = await Promise.all(keys.map(async (k) => [k, await loadViewed(k)] as const))
      setViewed(Object.fromEntries(entries))
      // Only prune on a complete answer — a forge error must not wipe ticks.
      if (!l.errors.length) pruneViewed(new Set(keys)).catch(() => {})
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setRefreshing(false)
    }
  }, [client, m])

  useEffect(() => {
    navigation.setOptions({ title: 'Pull requests' })
    return navigation.addListener('focus', () => { load() })
  }, [navigation, load])

  if (!m) return <Screen><Empty>Machine not found.</Empty></Screen>
  const all = list?.pulls ?? []
  const review = all.filter((p) => p.needsReview)
  const shown = filter === 'review' ? review : all

  return (
    <Screen>
      <Segmented value={filter} onChange={choose} options={[{ value: 'all', label: `All open${list ? ` ${all.length}` : ''}` }, { value: 'review', label: `Needs review${list ? ` ${review.length}` : ''}` }]} />
      {list === null && !error && <Loading label={`Asking ${m.name} for open pull requests…`} />}
      {error ? <Card><Text style={{ color: theme.red }}>{error}</Text><View style={{ height: 8 }} /><Button label="Retry" onPress={load} /></Card> : null}
      {list?.errors.map((e, i) => <Card key={i}><Text style={{ color: theme.yellow, fontSize: 12 }}>{e.forge}: {e.error}</Text></Card>)}
      <FlatList
        data={shown}
        keyExtractor={(p) => `${p.forge}|${p.repo}#${p.number}`}
        onRefresh={load}
        refreshing={refreshing && list !== null}
        ListEmptyComponent={list ? <Empty>{filter === 'review' ? 'Nothing waiting for your review.' : 'No open pull requests.'}</Empty> : null}
        renderItem={({ item }) => <PullRow p={item} v={viewed[viewedKey(item.forge, item.repo, item.number)] ?? null}
          onPress={() => navigation.navigate('Pull', { peerId: m.peerId, forge: item.forge, repo: item.repo, number: item.number, title: item.title })} />}
        ListFooterComponent={<View style={{ padding: 12 }}><Hint>Read through {m.name}: its forge token never leaves that machine. “Needs review” = open, not a draft, and you have no review on the latest commit.</Hint></View>}
      />
    </Screen>
  )
}

const PullRow: React.FC<{ p: PullSummary; v: ViewedState | null; onPress: () => void }> = ({ p, v, onPress }) => {
  const progress = v && v.head === p.headSha ? `${Math.min(v.hashes.length, p.files)}/${p.files} viewed` : v && v.hashes.length ? 'new commits since you looked' : ''
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Mono>{p.repo} #{p.number}</Mono>
        {p.draft && <Badge label="draft" color={theme.textMuted} />}
        <View style={{ flex: 1 }} />
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>{age(p.updatedAt)}</Text>
      </View>
      <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600', marginTop: 4 }} numberOfLines={2}>{p.title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
        <Text style={{ color: stateColor(p.checks), fontSize: 12, fontWeight: '600' }}>{checksLabel(p.checks)}</Text>
        {p.bots.filter((b) => b.state !== 'none').map((b) => <Text key={b.name} style={{ color: stateColor(b.state), fontSize: 12, fontWeight: '600' }}>{botLabel(b)}</Text>)}
        <Text style={{ color: theme.green, fontSize: 12 }}>+{p.add}</Text>
        <Text style={{ color: theme.red, fontSize: 12 }}>−{p.del}</Text>
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>{p.files} file{p.files === 1 ? '' : 's'}</Text>
        {p.needsReview && <Badge label="needs review" color={theme.accent} />}
      </View>
      {progress ? <Hint>{progress}</Hint> : null}
    </Card>
  )
}
