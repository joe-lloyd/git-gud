import React from 'react'
import { Text } from 'react-native'
import { theme } from './theme'
import { tokenize, type TokenKind } from './highlight'

const COLORS: Record<TokenKind, string> = {
  plain: theme.text, keyword: theme.accent, string: theme.yellow, comment: theme.textMuted, number: '#bd93f9', type: theme.cyan, punct: theme.textSecondary, attr: theme.cyan, tag: theme.accent,
}

/** One highlighted line of code (nested Text runs). */
export const CodeLine: React.FC<{ code: string; lang: string | null; dim?: boolean }> = ({ code, lang, dim }) => (
  <Text style={{ fontFamily: theme.mono, fontSize: 11.5, lineHeight: 17, color: theme.text, opacity: dim ? 0.75 : 1 }}>
    {tokenize(code, lang).map((t, i) => <Text key={i} style={{ color: COLORS[t.kind], fontStyle: t.kind === 'comment' ? 'italic' : 'normal' }}>{t.text}</Text>)}
    {code === '' ? ' ' : ''}
  </Text>
)
