import React, { useEffect, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Empty, Loading, Screen } from '../ui/atoms'
import { theme } from '../ui/theme'
import { useAppState } from '../state/AppState'
import type { RootStack } from '../navigation'

type FileDiffResult = { diff?: string; text?: string } | string

// Unified diff, syntax-lite: +/- colouring, hunk headers muted.
export const DiffScreen: React.FC<NativeStackScreenProps<RootStack, 'Diff'>> = ({ navigation, route }) => {
  const { machines, client } = useAppState()
  const m = machines.find((x) => x.peerId === route.params.peerId)
  const [diff, setDiff] = useState<string | null>(null)
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
  return (
    <Screen>
      <ScrollView horizontal><ScrollView>
        <View style={{ padding: 12 }}>
          {diff.split('\n').map((l, i) => (
            <Text key={i} style={{ fontFamily: theme.mono, fontSize: 11.5, lineHeight: 16, color: l.startsWith('+') ? theme.green : l.startsWith('-') ? theme.red : l.startsWith('@@') ? theme.cyan : l.startsWith('diff ') || l.startsWith('index ') ? theme.textMuted : theme.textSecondary }}>{l || ' '}</Text>
          ))}
        </View>
      </ScrollView></ScrollView>
    </Screen>
  )
}
