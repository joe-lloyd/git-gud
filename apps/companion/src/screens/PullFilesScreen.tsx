import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, Linking, Pressable, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { FileDiff, PullFile, PullFileList } from '@gitgud/peer-protocol'
import { Button, Card, Empty, Hint, Loading, Mono, Screen } from '../ui/atoms'
import { theme } from '../ui/theme'
import { DiffView } from '../ui/DiffView'
import { languageFor } from '../ui/highlight'
import { collapseReason } from '../ui/diffRows'
import { FILE_STATUS_LETTER } from '../ui/forge'
import { useAppState } from '../state/AppState'
import { RpcError } from '../net/peerClient'
import { firstUnviewed, loadViewed, saveViewed, shortHash, toggle, viewedKey, type ViewedState } from '../state/viewed'
import type { RootStack } from '../navigation'

type Slot = FileDiff | 'loading' | { error: string }

// One file per page; swipe sideways between files. Diffs load for the
// current page and its neighbours only, always pinned to the head the file
// list came from — a push mid-review shows a reload bar instead of mixing.
export const PullFilesScreen: React.FC<NativeStackScreenProps<RootStack, 'PullFiles'>> = ({ navigation, route }) => {
  const { machines, client } = useAppState()
  const m = machines.find((x) => x.peerId === route.params.peerId)
  const { forge, repo, number, url, startPath } = route.params
  const ref = { forge, repo, number }
  const key = viewedKey(forge, repo, number)
  const { width } = useWindowDimensions()
  const pager = useRef<FlatList<PullFile>>(null)
  const [list, setList] = useState<PullFileList | null>(null)
  const [error, setError] = useState('')
  const [index, setIndex] = useState(0)
  const [slots, setSlots] = useState<Record<string, Slot>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [viewed, setViewed] = useState<ViewedState | null>(null)
  const [stale, setStale] = useState(false)

  const loadList = useCallback(async (keepPath?: string) => {
    if (!client || !m) return
    try {
      const [l, v] = await Promise.all([client.forgeListFiles(m, ref), loadViewed(key)])
      setList(l); setViewed(v); setSlots({}); setStale(false); setError('')
      const want = keepPath ?? startPath
      const i = want ? Math.max(0, l.files.findIndex((f) => f.path === want)) : firstUnviewed(l.files, v)
      setIndex(i)
      requestAnimationFrame(() => pager.current?.scrollToIndex({ index: i, animated: false }))
    } catch (e) { setError(String((e as Error).message)) }
  }, [client, m, forge, repo, number, startPath]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadList() }, [loadList])

  useEffect(() => {
    if (list) navigation.setOptions({ title: list.files.length ? `${index + 1} / ${list.files.length}` : 'Files' })
  }, [navigation, list, index])

  // Fetch the visible page and its neighbours.
  useEffect(() => {
    if (!list || !client || !m || stale) return
    for (const i of [index, index + 1, index - 1]) {
      const f = list.files[i]
      if (!f || slots[f.path] || (collapseReason(f) && !expanded.has(f.path)) || f.binary) continue
      setSlots((s) => ({ ...s, [f.path]: 'loading' }))
      client.forgeFileDiff(m, ref, list.headSha, f.path)
        .then((d) => setSlots((s) => ({ ...s, [f.path]: d })))
        .catch((e) => {
          if (e instanceof RpcError && e.code === 'stale') { setStale(true); setSlots((s) => { const n = { ...s }; delete n[f.path]; return n }) }
          else setSlots((s) => ({ ...s, [f.path]: { error: String((e as Error).message) } }))
        })
    }
  }, [list, index, expanded, stale]) // eslint-disable-line react-hooks/exhaustive-deps

  const setSeen = async (f: PullFile, on: boolean) => {
    if (!list) return
    const next = toggle(viewed, list.headSha, list.files, f.patchHash, on)
    setViewed(next)
    await saveViewed(key, next).catch(() => {})
  }
  const go = (i: number) => {
    if (!list || i < 0 || i >= list.files.length) return
    setIndex(i)
    pager.current?.scrollToIndex({ index: i, animated: true })
  }
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))

  if (!m) return <Screen><Empty>Machine not found.</Empty></Screen>
  if (error) return <Screen><Card><Text style={{ color: theme.red }}>{error}</Text><View style={{ height: 8 }} /><Button label="Retry" onPress={() => loadList()} /></Card></Screen>
  if (!list) return <Screen><Loading label="Loading files…" /></Screen>
  if (!list.files.length) return <Screen><Empty>This pull request changes no files.</Empty></Screen>

  const cur = list.files[index]
  const curSeen = !!cur && !!viewed?.hashes.includes(shortHash(cur.patchHash))
  const last = index === list.files.length - 1
  const allSeen = list.files.every((f) => viewed?.hashes.includes(shortHash(f.patchHash)))

  return (
    <Screen>
      {stale && (
        <Pressable onPress={() => loadList(cur?.path)} style={{ backgroundColor: theme.yellow + '22', borderBottomWidth: 1, borderBottomColor: theme.yellow + '66', padding: 10 }}>
          <Text style={{ color: theme.yellow, fontSize: 13, fontWeight: '600' }}>This pull request has new commits. Tap to reload — files you viewed that didn't change stay ticked.</Text>
        </Pressable>
      )}
      <FlatList
        ref={pager}
        data={list.files}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(f) => f.path}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        initialScrollIndex={index}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={1}
        onMomentumScrollEnd={onScrollEnd}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item: f }) => (
          <View style={{ width }}>
            <FilePage f={f} slot={slots[f.path]} seen={!!viewed?.hashes.includes(shortHash(f.patchHash))} expanded={expanded.has(f.path)}
              onExpand={() => setExpanded((s) => new Set(s).add(f.path))} onToggleSeen={(on) => setSeen(f, on)} url={url} />
          </View>
        )}
      />
      <View style={{ flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.bgElevated }}>
        <View style={{ width: 64 }}><Button label="‹" disabled={index === 0} onPress={() => go(index - 1)} /></View>
        <View style={{ flex: 1 }}>
          {last && (curSeen || allSeen)
            ? <Button primary label={allSeen ? 'All viewed · back to PR' : 'Back to PR'} onPress={() => navigation.goBack()} />
            : <Button primary label={curSeen ? 'Next file ›' : last ? 'Mark viewed ✓' : 'Viewed ✓ & next ›'} onPress={async () => { if (cur && !curSeen) await setSeen(cur, true); if (!last) go(index + 1) }} />}
        </View>
        <View style={{ width: 64 }}><Button label="›" disabled={last} onPress={() => go(index + 1)} /></View>
      </View>
    </Screen>
  )
}

const REASON = { binary: 'Binary file — not shown', generated: 'Lockfile / generated — collapsed', large: 'Large diff — collapsed' } as const

const FilePage: React.FC<{ f: PullFile; slot?: Slot; seen: boolean; expanded: boolean; url?: string; onExpand(): void; onToggleSeen(on: boolean): void }> = ({ f, slot, seen, expanded, url, onExpand, onToggleSeen }) => {
  const lang = languageFor(f.path)
  const header = (
    <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Mono color={theme.yellow}>{FILE_STATUS_LETTER[f.status]}</Mono>
        <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600', flex: 1 }}>{f.path}</Text>
        <Pressable onPress={() => onToggleSeen(!seen)} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: seen ? theme.green : theme.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text style={{ color: seen ? theme.green : theme.textMuted, fontSize: 11, fontWeight: '700' }}>{seen ? '✓ VIEWED' : 'VIEWED?'}</Text>
        </Pressable>
      </View>
      {f.previous ? <Hint>renamed from {f.previous}</Hint> : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Text style={{ color: theme.green, fontSize: 12 }}>+{f.add}</Text>
        <Text style={{ color: theme.red, fontSize: 12 }}>−{f.del}</Text>
        {lang && <Text style={{ color: theme.textMuted, fontSize: 12 }}>{lang}</Text>}
      </View>
    </View>
  )
  const reason = collapseReason(f)
  if (f.binary) return <View>{header}<Empty>{REASON.binary}</Empty></View>
  if (reason && !expanded) return <View>{header}<Card><Text style={{ color: theme.textSecondary, fontSize: 13 }}>{REASON[reason]} · {f.lines.toLocaleString()} lines</Text><View style={{ height: 8 }} /><Button label="Load anyway" onPress={onExpand} /></Card></View>
  if (!slot || slot === 'loading') return <View>{header}<Loading label="Loading diff…" /></View>
  if ('error' in slot) return <View>{header}<Card><Text style={{ color: theme.red, fontSize: 13 }}>{slot.error}</Text></Card></View>
  const footer = slot.truncated
    ? <Card><Text style={{ color: theme.yellow, fontSize: 13 }}>Diff cut short ({slot.lines.toLocaleString()} lines total).</Text>{url ? <><View style={{ height: 8 }} /><Button label="Open full diff in Forgejo" onPress={() => Linking.openURL(`${url}/files`).catch(() => {})} /></> : null}</Card>
    : undefined
  return <DiffView patch={slot.patch} lang={lang} header={header} footer={footer} />
}
