import React, { useCallback, useEffect, useState } from 'react'
import { Linking, Pressable, ScrollView, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { BotVerdict, PullCommit, PullDetail, PullFileList } from '@gitgud/peer-protocol'
import { Badge, Button, Card, Empty, Hint, Loading, Mono, Screen, Segmented, Title } from '../ui/atoms'
import { theme } from '../ui/theme'
import { Markdown } from '../ui/Markdown'
import { FILE_STATUS_LETTER, age, botLabel, checksLabel, stateColor } from '../ui/forge'
import { useAppState } from '../state/AppState'
import { firstUnviewed, loadViewed, progress, shortHash, viewedKey, type ViewedState } from '../state/viewed'
import type { RootStack } from '../navigation'

type Tab = 'overview' | 'files' | 'commits'

// One PR: bot verdict + belt pinned on top, then Overview / Files / Commits.
export const PullScreen: React.FC<NativeStackScreenProps<RootStack, 'Pull'>> = ({ navigation, route }) => {
  const { machines, client } = useAppState()
  const m = machines.find((x) => x.peerId === route.params.peerId)
  const { forge, repo, number } = route.params
  const ref = { forge, repo, number }
  const [d, setD] = useState<PullDetail | null>(null)
  const [files, setFiles] = useState<PullFileList | null>(null)
  const [commits, setCommits] = useState<PullCommit[] | null>(null)
  const [viewed, setViewed] = useState<ViewedState | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!client || !m) return
    setViewed(await loadViewed(viewedKey(forge, repo, number)))
    client.forgeGetPull(m, { forge, repo, number }).then((x) => { setD(x); setError('') }).catch((e) => setError(String((e as Error).message)))
    client.forgeListFiles(m, { forge, repo, number }).then(setFiles).catch(() => {})
  }, [client, m, forge, repo, number])

  useEffect(() => {
    navigation.setOptions({ title: `${repo.split('/').pop()} #${number}` })
    return navigation.addListener('focus', () => { load() })
  }, [navigation, load, repo, number])

  useEffect(() => {
    if (tab === 'commits' && commits === null && client && m) client.forgeListCommits(m, ref).then(setCommits).catch(() => setCommits([]))
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!m) return <Screen><Empty>Machine not found.</Empty></Screen>
  if (!d) return <Screen>{error ? <Card><Text style={{ color: theme.red }}>{error}</Text><View style={{ height: 8 }} /><Button label="Retry" onPress={load} /></Card> : <Loading label="Loading pull request…" />}</Screen>

  const prog = files ? progress(files.files, viewed) : null
  const review = (startPath?: string) => navigation.navigate('PullFiles', { peerId: m.peerId, forge, repo, number, url: d.url, ...(startPath ? { startPath } : {}) })
  const belt = d.statuses.filter((s) => !d.bots.some((b) => b.context === s.context))

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
        <Card>
          <Title>{d.title}</Title>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <Mono color={theme.accent}>{d.base} ← {d.head}</Mono>
            <Text style={{ color: theme.textMuted, fontSize: 12 }}>{d.author} · {age(d.updatedAt)}</Text>
            {d.draft && <Badge label="draft" color={theme.textMuted} />}
            {d.mergeable === false && <Badge label="conflicts" color={theme.red} />}
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            <Text style={{ color: theme.green, fontSize: 12 }}>+{d.add}</Text>
            <Text style={{ color: theme.red, fontSize: 12 }}>−{d.del}</Text>
            <Text style={{ color: theme.textMuted, fontSize: 12 }}>{d.files} files · {d.headSha.slice(0, 8)}</Text>
          </View>
        </Card>

        {d.bots.filter((b) => b.state !== 'none' || b.body).map((b) => <BotCard key={b.name} b={b} />)}

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: stateColor(d.checks), fontWeight: '700', fontSize: 13 }}>{checksLabel(d.checks)}</Text>
          </View>
          {belt.length === 0 && <Hint>No status checks on this commit.</Hint>}
          {belt.map((s) => (
            <Pressable key={s.context} disabled={!s.url} onPress={() => s.url && Linking.openURL(s.url).catch(() => {})} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: stateColor(s.state) }} />
              <Text style={{ color: theme.text, fontSize: 12.5 }}>{s.context}</Text>
              <Text style={{ color: theme.textMuted, fontSize: 12, flex: 1 }} numberOfLines={1}>{s.description}</Text>
            </Pressable>
          ))}
        </Card>

        <View style={{ paddingHorizontal: 12, paddingTop: 12 }}>
          <Button primary label={!prog || prog.total === 0 ? 'Review files' : prog.viewed === 0 ? `Start reviewing · ${prog.total} files` : prog.viewed < prog.total ? `Continue reviewing · ${prog.viewed}/${prog.total}` : 'All files viewed · review again'}
            onPress={() => review(files && prog && prog.viewed < prog.total ? files.files[firstUnviewed(files.files, viewed)]?.path : undefined)} />
        </View>

        <Segmented value={tab} onChange={setTab} options={[{ value: 'overview', label: 'Overview' }, { value: 'files', label: `Files${files ? ` ${files.files.length}` : ''}` }, { value: 'commits', label: 'Commits' }]} />

        {tab === 'overview' && (
          <Card>
            {d.body.trim() ? <Markdown source={d.body} /> : <Hint>No description.</Hint>}
            {d.reviews.length > 0 && <View style={{ marginTop: 12, gap: 4 }}>
              <Text style={{ color: theme.text, fontWeight: '600', fontSize: 13 }}>Reviews</Text>
              {d.reviews.map((r, i) => <Text key={i} style={{ color: theme.textSecondary, fontSize: 12 }}>{r.user} · {r.state.toLowerCase().replace('_', ' ')}{r.commitId && r.commitId !== d.headSha ? ' (older commit)' : ''} · {age(r.submittedAt)}</Text>)}
            </View>}
          </Card>
        )}

        {tab === 'files' && (files === null ? <Loading /> : (
          <Card>
            {files.files.map((f) => {
              const seen = viewed?.hashes.includes(shortHash(f.patchHash))
              return (
                <Pressable key={f.path} onPress={() => review(f.path)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 }}>
                  <Text style={{ color: seen ? theme.green : theme.border, fontSize: 13, width: 14 }}>{seen ? '✓' : '○'}</Text>
                  <Mono color={theme.yellow}>{FILE_STATUS_LETTER[f.status]}</Mono>
                  <Text style={{ color: seen ? theme.textMuted : theme.text, fontSize: 13, flex: 1 }} numberOfLines={2}>{f.previous ? `${f.previous} → ` : ''}{f.path}</Text>
                  {f.binary ? <Text style={{ color: theme.textMuted, fontSize: 11 }}>bin</Text> : <>
                    <Text style={{ color: theme.green, fontSize: 12 }}>+{f.add}</Text>
                    <Text style={{ color: theme.red, fontSize: 12 }}>−{f.del}</Text>
                  </>}
                </Pressable>
              )
            })}
          </Card>
        ))}

        {tab === 'commits' && (commits === null ? <Loading /> : (
          <Card>
            {commits.length === 0 && <Hint>No commits.</Hint>}
            {commits.map((c) => (
              <View key={c.sha} style={{ flexDirection: 'row', gap: 8, paddingVertical: 6 }}>
                <Mono color={theme.accent}>{c.sha.slice(0, 7)}</Mono>
                <Text style={{ color: theme.text, fontSize: 13, flex: 1 }} numberOfLines={2}>{c.subject}</Text>
                <Text style={{ color: theme.textMuted, fontSize: 11 }}>{age(c.date)}</Text>
              </View>
            ))}
          </Card>
        ))}

        <View style={{ padding: 12 }}><Button label="Open in Forgejo" onPress={() => Linking.openURL(d.url).catch(() => {})} /></View>
      </ScrollView>
    </Screen>
  )
}

const BotCard: React.FC<{ b: BotVerdict }> = ({ b }) => {
  const [open, setOpen] = useState(false)
  const color = stateColor(b.state)
  const focus = b.focus ?? []
  return (
    <Card style={{ borderColor: color + '88' }} onPress={() => setOpen((o) => !o)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color, fontWeight: '700', fontSize: 13 }}>{botLabel(b)}</Text>
        <View style={{ flex: 1 }} />
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>{open ? 'less ▴' : 'more ▾'}</Text>
      </View>
      <Text style={{ color: theme.textSecondary, fontSize: 13, marginTop: 4 }}>{b.headline ?? b.description}</Text>
      {(open ? focus : focus.slice(0, 2)).map((f, i) => <Text key={i} style={{ color: theme.textSecondary, fontSize: 12.5, marginTop: 4 }}>• {f}</Text>)}
      {open && b.body ? <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10 }}><Markdown source={b.body} /></View> : null}
      <Hint>Advisory first pass — the belt checks are what gate a merge.</Hint>
    </Card>
  )
}
