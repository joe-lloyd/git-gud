import React, { useEffect, useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Card, Hint, Loading, Mono, Screen, Title, Empty } from '../ui/atoms'
import { theme } from '../ui/theme'
import { useAppState } from '../state/AppState'
import type { RootStack } from '../navigation'

type FileChange = { path: string; status?: string; add?: number; del?: number }

export const CommitScreen: React.FC<NativeStackScreenProps<RootStack, 'Commit'>> = ({ navigation, route }) => {
  const { machines, client } = useAppState()
  const m = machines.find((x) => x.peerId === route.params.peerId)
  const [files, setFiles] = useState<FileChange[] | null>(null)
  const [message, setMessage] = useState<string>('')
  useEffect(() => {
    navigation.setOptions({ title: route.params.sha.slice(0, 7) })
    if (!client || !m) return
    client.rpc<FileChange[]>(m, route.params.repoPath, 'getCommitFiles', [route.params.sha]).then(setFiles).catch(() => setFiles([]))
    client.rpc<string>(m, route.params.repoPath, 'getCommitMessage', [route.params.sha]).then(setMessage).catch(() => {})
  }, [client, m, route.params, navigation])
  if (!m) return <Screen><Empty>Machine not found.</Empty></Screen>
  return (
    <Screen>
      <Card><Title>{route.params.subject}</Title>{message.split('\n').slice(1).join('\n').trim() ? <Text style={{ color: theme.textSecondary, marginTop: 6, fontSize: 13 }}>{message.split('\n').slice(1).join('\n').trim()}</Text> : null}<View style={{ height: 6 }} /><Mono>{route.params.sha}</Mono></Card>
      {files === null ? <Loading /> : (
        <FlatList data={files} keyExtractor={(f) => f.path} ListHeaderComponent={<View style={{ paddingHorizontal: 12, paddingTop: 12 }}><Hint>{files.length} files · +{files.reduce((a, f) => a + (f.add ?? 0), 0)} −{files.reduce((a, f) => a + (f.del ?? 0), 0)}</Hint></View>}
          renderItem={({ item: f }) => (
            <Pressable onPress={() => navigation.navigate('Diff', { peerId: m.peerId, repoPath: route.params.repoPath, path: f.path, sha: route.params.sha })} style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
              <Mono color={theme.yellow}>{(f.status ?? 'M').slice(0, 1)}</Mono><Text style={{ color: theme.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{f.path}</Text>
              {f.add ? <Text style={{ color: theme.green, fontSize: 12 }}>+{f.add}</Text> : null}{f.del ? <Text style={{ color: theme.red, fontSize: 12 }}>-{f.del}</Text> : null}
            </Pressable>
          )} />
      )}
    </Screen>
  )
}
