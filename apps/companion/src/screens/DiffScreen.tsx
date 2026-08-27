import React, { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Empty, Loading, Screen } from '../ui/atoms'
import { theme } from '../ui/theme'
import { useAppState } from '../state/AppState'
import type { RootStack } from '../navigation'
import { classifyDiffLine, languageFor } from '../ui/highlight'
import { CodeLine } from '../ui/Code'

type FileDiffResult = { diff?: string; text?: string } | string

// Unified diff with syntax highlighting: the +/- state tints the row
// background, the code itself keeps its language colours.
export const DiffScreen: React.FC<NativeStackScreenProps<RootStack, 'Diff'>> = ({ navigation, route }) => {
  const { machines, client } = useAppState()
  const m = machines.find((x) => x.peerId === route.params.peerId)
  const [diff, setDiff] = useState<string | null>(null)
  const lang = useMemo(() => languageFor(route.params.path), [route.params.path])
  useEffect(() => {
    navigation.setOptions({ title: route.params.path.split('/').pop() })
    if (!client || !m) return
    const p = route.params.sha
      ? client.rpc<string>(m, route.params.repoPath, 'getCommitFileDiff', [route.params.sha, route.params.path, {}])
      : client.rpc<FileDiffResult>(m, route.params.repoPath, 'getFileDiff', [route.params.path, route.params.staged === true, {}]).then((r) => (typeof r === 'string' ? r : r.diff ?? r.text ?? JSON.stringify(r)))
    p.then(setDiff).catch((e) => setDiff(`error: ${String((e as Error).message)}`))
  }, [client, m, route.params, navigation])
  if (!m) return <Screen><Empty>Machine not found.</Empty></Screen>
  if (diff === null) return <Screen><Loading label="Loading diff…" /></Screen>
  const lines = diff.split('\n')
  return (
    <Screen>
      <View style={{ paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', gap: 8 }}>
        <Text style={{ color: theme.textMuted, fontSize: 11 }} numberOfLines={1}>{route.params.path}</Text>
        {lang && <Text style={{ color: theme.textMuted, fontSize: 11 }}>· {lang}</Text>}
      </View>
      <ScrollView horizontal bounces={false}><ScrollView>
        <View style={{ paddingBottom: 24 }}>
          {lines.map((l, i) => {
            const c = classifyDiffLine(l)
            if (c.kind === 'hunk' || c.kind === 'meta') return <Text key={i} style={{ fontFamily: theme.mono, fontSize: 11, lineHeight: 17, color: c.kind === 'hunk' ? theme.cyan : theme.textMuted, paddingHorizontal: 12, backgroundColor: c.kind === 'hunk' ? theme.bgElevated : 'transparent' }}>{l}</Text>
            const bg = c.kind === 'add' ? '#50fa7b1a' : c.kind === 'del' ? '#ff55551f' : 'transparent'
            const markerColor = c.kind === 'add' ? theme.green : c.kind === 'del' ? theme.red : theme.textMuted
            return (
              <View key={i} style={{ flexDirection: 'row', backgroundColor: bg, paddingRight: 24 }}>
                <Text style={{ fontFamily: theme.mono, fontSize: 11.5, lineHeight: 17, color: markerColor, width: 22, textAlign: 'center' }}>{c.marker}</Text>
                <CodeLine code={c.code} lang={lang} dim={c.kind === 'ctx'} />
              </View>
            )
          })}
        </View>
      </ScrollView></ScrollView>
    </Screen>
  )
}
