import React, { useMemo } from 'react'
import { FlatList, Text, View } from 'react-native'
import { theme } from './theme'
import { CodeLine } from './Code'
import { diffRows, type DiffRow } from './diffRows'

const ADD_BG = '#50fa7b1a'
const DEL_BG = '#ff55551f'
const GUTTER = 38

// Virtualised unified diff. Lines wrap (no sideways scrolling); the gutter
// shows the new line number (old for deletions) and stays blank on wrapped
// continuations because the number sits only on the row's first line.
export const DiffView: React.FC<{ patch: string; lang: string | null; header?: React.ReactElement; footer?: React.ReactElement; meta?: boolean }> = ({ patch, lang, header, footer, meta }) => {
  const rows = useMemo(() => diffRows(patch, { meta }), [patch, meta])
  return (
    <FlatList
      data={rows}
      keyExtractor={(_, i) => String(i)}
      renderItem={({ item }) => <Row row={item} lang={lang} />}
      initialNumToRender={60}
      maxToRenderPerBatch={80}
      windowSize={9}
      ListHeaderComponent={header}
      ListFooterComponent={footer ?? <View style={{ height: 24 }} />}
    />
  )
}

const Row = React.memo<{ row: DiffRow; lang: string | null }>(({ row, lang }) => {
  if (row.kind === 'hunk') return <Text style={{ fontFamily: theme.mono, fontSize: 11, lineHeight: 17, color: theme.cyan, backgroundColor: theme.bgElevated, paddingHorizontal: 12, paddingVertical: 2, marginTop: 4 }} numberOfLines={1}>{row.text}</Text>
  if (row.kind === 'meta') return <Text style={{ fontFamily: theme.mono, fontSize: 11, lineHeight: 17, color: theme.textMuted, paddingHorizontal: 12 }}>{row.text}</Text>
  if (row.kind === 'note') return <Text style={{ fontFamily: theme.mono, fontSize: 10.5, lineHeight: 16, color: theme.textMuted, fontStyle: 'italic', paddingLeft: GUTTER + 16 }}>{row.text}</Text>
  const bg = row.kind === 'add' ? ADD_BG : row.kind === 'del' ? DEL_BG : 'transparent'
  const marker = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '
  const markerColor = row.kind === 'add' ? theme.green : row.kind === 'del' ? theme.red : theme.textMuted
  const no = row.kind === 'del' ? row.oldNo : row.newNo
  return (
    <View style={{ flexDirection: 'row', backgroundColor: bg, paddingRight: 8 }}>
      <Text style={{ fontFamily: theme.mono, fontSize: 10, lineHeight: 17, color: theme.textMuted, width: GUTTER, textAlign: 'right', paddingRight: 4, opacity: 0.8 }}>{no ?? ''}</Text>
      <Text style={{ fontFamily: theme.mono, fontSize: 11.5, lineHeight: 17, color: markerColor, width: 14, textAlign: 'center' }}>{marker}</Text>
      <View style={{ flex: 1 }}><CodeLine code={row.code} lang={lang} dim={row.kind === 'ctx'} /></View>
    </View>
  )
})
