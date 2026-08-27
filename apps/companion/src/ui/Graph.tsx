import React, { useEffect, useMemo, useState } from 'react'
import { FlatList, Modal, Pressable, ScrollView, Text, View } from 'react-native'
import Svg, { Circle, Line, Path } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Badge, Hint, Loading, Mono, Button } from './atoms'
import { theme } from './theme'
import { ago, assignLanes, laneColor, type LaneRow, type LogRow } from '../net/lanes'

// Row geometry: the SVG glyph is exactly ROW_H tall and every row is exactly
// ROW_H tall, so a line drawn to y=ROW_H meets the next row's line at y=0.
export const ROW_H = 44
const LANE_W = 14
const NODE_R = 4.5
const xOf = (l: number) => 8 + l * LANE_W

export const LaneGlyph: React.FC<{ r: LaneRow }> = ({ r }) => {
  const width = xOf(r.lanes - 1) + 10, mid = ROW_H / 2, x = xOf(r.lane), c = laneColor(r.lane)
  // Curves use a cubic that leaves vertically and arrives vertically, so a
  // fork looks like a rail switch rather than a diagonal.
  const curve = (x1: number, y1: number, x2: number, y2: number) => `M${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`
  return (
    <Svg width={width} height={ROW_H}>
      {r.through.map((l) => <Line key={`t${l}`} x1={xOf(l)} y1={0} x2={xOf(l)} y2={ROW_H} stroke={laneColor(l)} strokeWidth={2} />)}
      {r.joins.map((l) => <Path key={`j${l}`} d={curve(xOf(l), 0, x, mid)} stroke={laneColor(l)} strokeWidth={2} fill="none" />)}
      {r.forks.map((l) => <Path key={`f${l}`} d={curve(x, mid, xOf(l), ROW_H)} stroke={laneColor(l)} strokeWidth={2} fill="none" />)}
      {r.fromTop && <Line x1={x} y1={0} x2={x} y2={mid} stroke={c} strokeWidth={2} />}
      {r.toBottom && <Line x1={x} y1={mid} x2={x} y2={ROW_H} stroke={c} strokeWidth={2} />}
      <Circle cx={x} cy={mid} r={NODE_R + 1.5} fill={theme.bg} />
      <Circle cx={x} cy={mid} r={NODE_R} fill={r.row.parents.length > 1 ? theme.bg : c} stroke={c} strokeWidth={2} />
    </Svg>
  )
}

const refLabel = (ref: string) => ref.replace(/^refs\/(heads|remotes|tags)\//, '').replace(/^tag: /, '')
const isTag = (ref: string) => /^refs\/tags\/|^tag: /.test(ref)
const isHead = (ref: string) => /^HEAD\b|HEAD -> /.test(ref)

/** Minimal row: glyph · subject · (up to two ref pills) · age. Details live in the drawer. */
const Row: React.FC<{ r: LaneRow; onPress: () => void }> = ({ r, onPress }) => {
  const refs = (r.row.refs ?? []).filter((x) => !isHead(x) || /->/.test(x)).map((x) => x.replace(/^HEAD -> /, ''))
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', height: ROW_H, paddingLeft: 8, paddingRight: 12, backgroundColor: pressed ? theme.bgHover : 'transparent' })}>
      <LaneGlyph r={r} />
      <View style={{ flex: 1, marginLeft: 6, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {refs.slice(0, 2).map((ref) => <Badge key={ref} label={refLabel(ref)} color={isTag(ref) ? theme.yellow : theme.accent} />)}
        {refs.length > 2 && <Badge label={`+${refs.length - 2}`} color={theme.textMuted} />}
        <Text style={{ color: theme.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{r.row.message.split('\n')[0]}</Text>
        <Text style={{ color: theme.textMuted, fontSize: 11, fontVariant: ['tabular-nums'] }}>{ago(r.row.timestamp ?? r.row.date)}</Text>
      </View>
    </Pressable>
  )
}

export type FileChange = { path: string; status?: string; add?: number; del?: number }
export interface CommitDetailLoader { files(sha: string): Promise<FileChange[]>; message(sha: string): Promise<string> }

/** Bottom drawer with everything the row hides: full message, author, date, sha, refs, changed files. */
export const CommitDrawer: React.FC<{ row: LogRow | null; load: CommitDetailLoader; onClose: () => void; onOpenFile: (path: string) => void }> = ({ row, load, onClose, onOpenFile }) => {
  const insets = useSafeAreaInsets()
  const [files, setFiles] = useState<FileChange[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    setFiles(null); setMessage(null)
    if (!row) return
    let alive = true
    load.files(row.sha).then((f) => alive && setFiles(f)).catch(() => alive && setFiles([]))
    load.message(row.sha).then((m) => alive && setMessage(m)).catch(() => alive && setMessage(row.message))
    return () => { alive = false }
  }, [row?.sha]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!row) return null
  const full = message ?? row.message
  const [subject, ...bodyLines] = full.split('\n')
  const body = bodyLines.join('\n').trim()
  const when = row.timestamp ? new Date(row.timestamp < 1e12 ? row.timestamp * 1000 : row.timestamp) : row.date ? new Date(row.date) : null
  const adds = (files ?? []).reduce((a, f) => a + (f.add ?? 0), 0), dels = (files ?? []).reduce((a, f) => a + (f.del ?? 0), 0)
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: '#00000088' }} onPress={onClose} />
      <View style={{ backgroundColor: theme.bgElevated, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderColor: theme.border, borderWidth: 1, maxHeight: '80%', paddingBottom: insets.bottom + 8 }}>
        <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, marginTop: 8 }} />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{subject}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {(row.refs ?? []).map((ref) => <Badge key={ref} label={refLabel(ref.replace(/^HEAD -> /, ''))} color={isTag(ref) ? theme.yellow : theme.accent} />)}
          </View>
          <View style={{ gap: 2 }}>
            <Mono color={theme.textSecondary}>{row.sha}</Mono>
            <Text style={{ color: theme.textSecondary, fontSize: 13 }}>{row.author ?? '—'}{when && !Number.isNaN(when.getTime()) ? ` · ${when.toLocaleString()}` : ''}</Text>
            {row.parents.length > 1 && <Hint>Merge of {row.parents.length} parents: {row.parents.map((p) => p.slice(0, 7)).join(', ')}</Hint>}
          </View>
          {body ? <Text style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 19, fontFamily: /^(\s{4}|\t)/m.test(body) ? theme.mono : undefined }}>{body}</Text> : null}
          <View style={{ height: 1, backgroundColor: theme.border }} />
          {files === null ? <Loading /> : (
            <>
              <Hint>{files.length} file{files.length === 1 ? '' : 's'} · <Text style={{ color: theme.green }}>+{adds}</Text> <Text style={{ color: theme.red }}>−{dels}</Text></Hint>
              {files.map((f) => (
                <Pressable key={f.path} onPress={() => onOpenFile(f.path)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
                  <Mono color={f.status?.startsWith('A') ? theme.green : f.status?.startsWith('D') ? theme.red : theme.yellow}>{(f.status ?? 'M').slice(0, 1)}</Mono>
                  <Text style={{ color: theme.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{f.path}</Text>
                  {f.add ? <Text style={{ color: theme.green, fontSize: 12 }}>+{f.add}</Text> : null}{f.del ? <Text style={{ color: theme.red, fontSize: 12 }}>−{f.del}</Text> : null}
                </Pressable>
              ))}
            </>
          )}
          <Button label="Close" onPress={onClose} />
        </ScrollView>
      </View>
    </Modal>
  )
}

export const CommitGraph: React.FC<{ log: LogRow[] | null; load: CommitDetailLoader; onOpenFile: (sha: string, path: string) => void }> = ({ log, load, onOpenFile }) => {
  const rows = useMemo(() => (log ? assignLanes(log) : []), [log])
  const [selected, setSelected] = useState<LogRow | null>(null)
  if (log === null) return <Loading label="Loading history…" />
  return (
    <>
      <FlatList data={rows} keyExtractor={(r) => r.sha} renderItem={({ item }) => <Row r={item} onPress={() => setSelected(item.row)} />}
        getItemLayout={(_, i) => ({ length: ROW_H, offset: ROW_H * i, index: i })} initialNumToRender={24} windowSize={9}
        ListEmptyComponent={<View style={{ padding: 24 }}><Hint>No commits yet.</Hint></View>} />
      <CommitDrawer row={selected} load={load} onClose={() => setSelected(null)} onOpenFile={(p) => { if (selected) { const sha = selected.sha; setSelected(null); onOpenFile(sha, p) } }} />
    </>
  )
}
