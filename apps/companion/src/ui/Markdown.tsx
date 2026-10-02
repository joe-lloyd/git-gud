import React, { useMemo } from 'react'
import { Linking, Text, View } from 'react-native'
import { theme } from './theme'
import { CodeLine } from './Code'
import { languageFor } from './highlight'
import { parseMarkdown, type Inline } from './mdParse'

// Renders the markdown subset from ./mdParse.ts. Links open in the browser.
export const Markdown: React.FC<{ source: string }> = ({ source }) => {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  return (
    <View style={{ gap: 8 }}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading': return <Text key={i} style={{ color: theme.text, fontWeight: '700', fontSize: b.level <= 2 ? 16 : 14, marginTop: 4 }}><Inlines parts={b.inline} /></Text>
          case 'para': return <Text key={i} style={{ color: theme.textSecondary, fontSize: 13.5, lineHeight: 20 }}><Inlines parts={b.inline} /></Text>
          case 'item': return (
            <View key={i} style={{ flexDirection: 'row', paddingLeft: b.depth * 14, gap: 6 }}>
              <Text style={{ color: theme.textMuted, fontSize: 13.5, lineHeight: 20, minWidth: 12 }}>{b.marker}</Text>
              <Text style={{ color: theme.textSecondary, fontSize: 13.5, lineHeight: 20, flex: 1 }}><Inlines parts={b.inline} /></Text>
            </View>
          )
          case 'quote': return <Text key={i} style={{ color: theme.textMuted, fontSize: 13.5, lineHeight: 20, borderLeftWidth: 3, borderLeftColor: theme.border, paddingLeft: 8 }}><Inlines parts={b.inline} /></Text>
          case 'code': {
            const lang = b.lang ? languageFor(`x.${b.lang}`) : null
            return <View key={i} style={{ backgroundColor: theme.bg, borderRadius: 6, padding: 8 }}>{b.text.split('\n').map((l, j) => <CodeLine key={j} code={l} lang={lang} />)}</View>
          }
          case 'table': return <Text key={i} style={{ fontFamily: theme.mono, fontSize: 11, lineHeight: 16, color: theme.textSecondary }}>{b.text}</Text>
          case 'rule': return <View key={i} style={{ height: 1, backgroundColor: theme.border }} />
        }
      })}
    </View>
  )
}

const Inlines: React.FC<{ parts: Inline[] }> = ({ parts }) => (
  <>
    {parts.map((p, i) => (
      <Text key={i}
        onPress={p.href ? () => { Linking.openURL(p.href!).catch(() => {}) } : undefined}
        style={{
          ...(p.code ? { fontFamily: theme.mono, fontSize: 12, color: theme.yellow } : null),
          ...(p.bold ? { fontWeight: '700', color: theme.text } : null),
          ...(p.italic ? { fontStyle: 'italic' } : null),
          ...(p.href ? { color: theme.cyan, textDecorationLine: 'underline' } : null),
        }}>{p.text}</Text>
    ))}
  </>
)
