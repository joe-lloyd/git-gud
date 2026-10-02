import React, { useEffect, useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Empty, Loading, Screen } from '../ui/atoms'
import { theme } from '../ui/theme'
import { useAppState } from '../state/AppState'
import type { RootStack } from '../navigation'
import { languageFor } from '../ui/highlight'
import { DiffView } from '../ui/DiffView'

type FileDiffResult = { diff?: string; text?: string } | string

// Unified diff with syntax highlighting: the +/- state tints the row
// background, the code itself keeps its language colours. Lines wrap.
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
  return (
    <Screen>
      <DiffView patch={diff} lang={lang} meta
        header={<View style={{ paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', gap: 8 }}>
          <Text style={{ color: theme.textMuted, fontSize: 11 }} numberOfLines={1}>{route.params.path}</Text>
          {lang && <Text style={{ color: theme.textMuted, fontSize: 11 }}>· {lang}</Text>}
        </View>} />
    </Screen>
  )
}
