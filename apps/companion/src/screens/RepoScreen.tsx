import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { PeerEvent } from '@gitgud/peer-protocol'
import { Badge, Card, Empty, Hint, Loading, Mono, Screen, Title } from '../ui/atoms'
import { theme } from '../ui/theme'
import { useAppState } from '../state/AppState'
import { assignLanes, LANE_COLORS, type LogRow } from '../net/lanes'
import type { RootStack } from '../navigation'
import { LaneGlyph } from '../ui/LaneGlyph'

type Tab = 'graph' | 'tree' | 'activity'
type FileChange = { path: string; status?: string; add?: number; del?: number }
type RepoStatus = { branch: string; ahead: number; behind: number; staged: FileChange[]; unstaged: FileChange[]; untracked: string[] }

// One repository: commit graph (lanes), working tree, live activity. The SSE
// stream is open only while this screen is mounted (foreground).
export const RepoScreen: React.FC<NativeStackScreenProps<RootStack, 'Repo'>> = ({ navigation, route }) => {
  const { machines, client } = useAppState()
  const m = machines.find((x) => x.peerId === route.params.peerId)
  const { repoPath, name } = route.params
  const [tab, setTab] = useState<Tab>('graph')
  const [log, setLog] = useState<LogRow[] | null>(null)
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [activity, setActivity] = useState<Array<{ ts: number; text: string }>>([])
  const [live, setLive] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const closeRef = useRef<(() => void) | null>(null)

  const load = useCallback(async () => {
    if (!client || !m) return
    client.rpc<LogRow[]>(m, repoPath, 'getLog', [200]).then(setLog).catch(() => setLog([]))
    client.rpc<RepoStatus>(m, repoPath, 'getStatus').then(setStatus).catch(() => {})
  }, [client, m, repoPath])

  useEffect(() => {
    navigation.setOptions({ title: name })
    load()
    if (!client || !m) return
    const open = () => {
      closeRef.current = client.events(m, [repoPath], (ev: PeerEvent) => {
        if (ev.type === 'repo-changed') { setActivity((a) => [{ ts: Date.now(), text: 'repo changed' }, ...a].slice(0, 100)); load() }
        else if (ev.type === 'activity') {
          const rec = ev.record as { args?: string[]; failed?: boolean; kind?: string }
          const text = rec.args?.slice(0, 3).join(' ') ?? 'activity'
          setActivity((a) => [{ ts: Date.now(), text: `${rec.failed ? '✗ ' : ''}${text}` }, ...a].slice(0, 100))
        } else if (ev.type === 'ping') setLive('live')
      }, () => { setLive('offline'); setTimeout(open, 5000) })
      setLive('live')
    }
    open()
    return () => { closeRef.current?.(); closeRef.current = null }
  }, [client, m, repoPath, load, navigation, name])

  if (!m) return <Screen><Empty>Machine not found.</Empty></Screen>
  const lanes = log ? assignLanes(log) : []
  const dirty = status ? status.staged.length + status.unstaged.length + status.untracked.length : 0

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10 }}>
        {status && <Mono color={theme.accent}>{status.branch}</Mono>}
        {status && status.ahead > 0 && <Text style={{ color: theme.green, fontSize: 12 }}>↑{status.ahead}</Text>}
        {status && status.behind > 0 && <Text style={{ color: theme.cyan, fontSize: 12 }}>↓{status.behind}</Text>}
        <View style={{ flex: 1 }} />
        <Badge label={live === 'live' ? 'live' : live} color={live === 'live' ? theme.green : theme.textMuted} />
        {m.readOnly && <Badge label="read-only" color={theme.cyan} />}
      </View>
      <View style={{ flexDirection: 'row', margin: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' }}>
        {(['graph', 'tree', 'activity'] as Tab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={{ flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: tab === t ? theme.bgHover : theme.bgElevated }}>
            <Text style={{ color: tab === t ? theme.text : theme.textMuted, fontSize: 13, fontWeight: '600' }}>{t === 'graph' ? 'Graph' : t === 'tree' ? `Working tree${dirty ? ` (${dirty})` : ''}` : 'Activity'}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'graph' && (log === null ? <Loading label="Loading history…" /> : (
        <FlatList data={lanes} keyExtractor={(r) => r.sha} renderItem={({ item: r }) => (
          <Pressable onPress={() => navigation.navigate('Commit', { peerId: m.peerId, repoPath, sha: r.sha, subject: r.row.message.split('\n')[0] })} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: pressed ? theme.bgHover : 'transparent' })}>
            <LaneGlyph lane={r.lane} lanes={r.lanes} parents={r.parentsLanes} color={LANE_COLORS[r.lane % LANE_COLORS.length]} />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                {(r.row.refs ?? []).slice(0, 3).map((ref) => <Badge key={ref} label={ref.replace(/^refs\/(heads|remotes|tags)\//, '')} color={/^refs\/tags|^tag:/.test(ref) ? theme.yellow : theme.accent} />)}
                <Text style={{ color: theme.text, fontSize: 13 }} numberOfLines={1}>{r.row.message.split('\n')[0]}</Text>
              </View>
              <Mono>{r.sha.slice(0, 7)}{r.row.author ? ` · ${r.row.author}` : ''}{r.row.date ? ` · ${ago(r.row.date)}` : ''}</Mono>
            </View>
          </Pressable>
        )} />
      ))}

      {tab === 'tree' && (status === null ? <Loading /> : (
        <ScrollView>
          {(['staged', 'unstaged'] as const).map((sec) => (
            <Card key={sec}>
              <Title>{sec === 'staged' ? `Staged (${status.staged.length})` : `Changes (${status.unstaged.length + status.untracked.length})`}</Title>
              {status[sec].map((f) => (
                <Pressable key={f.path} onPress={() => navigation.navigate('Diff', { peerId: m.peerId, repoPath, path: f.path, staged: sec === 'staged' })} style={{ flexDirection: 'row', paddingVertical: 6, gap: 8 }}>
                  <Mono color={theme.yellow}>{(f.status ?? 'M').slice(0, 1)}</Mono><Text style={{ color: theme.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{f.path}</Text>
                  {f.add ? <Text style={{ color: theme.green, fontSize: 12 }}>+{f.add}</Text> : null}{f.del ? <Text style={{ color: theme.red, fontSize: 12 }}>-{f.del}</Text> : null}
                </Pressable>
              ))}
              {sec === 'unstaged' && status.untracked.map((p) => <View key={p} style={{ flexDirection: 'row', paddingVertical: 6, gap: 8 }}><Mono color={theme.green}>?</Mono><Text style={{ color: theme.textSecondary, fontSize: 13 }}>{p}</Text></View>)}
              {sec === 'staged' && status.staged.length === 0 && <Hint>Nothing staged</Hint>}
              {sec === 'unstaged' && status.unstaged.length + status.untracked.length === 0 && <Hint>Working tree clean</Hint>}
            </Card>
          ))}
          <View style={{ padding: 12 }}><Hint>Viewing only — stage, discard and commit from a desktop Git Gud connected to {m.name}.</Hint></View>
        </ScrollView>
      ))}

      {tab === 'activity' && (
        <FlatList data={activity} keyExtractor={(a, i) => `${a.ts}-${i}`} ListEmptyComponent={<Empty>Live events from {m.name} appear here while this screen is open: repo changes and git operations run there.</Empty>}
          renderItem={({ item }) => <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 6 }}><Mono>{new Date(item.ts).toLocaleTimeString()}</Mono><Text style={{ color: theme.text, fontSize: 13 }}>{item.text}</Text></View>} />
      )}
    </Screen>
  )
}

function ago(d: string | number): string {
  const t = typeof d === 'number' ? d : Date.parse(d)
  if (!Number.isFinite(t)) return String(d)
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`
}
