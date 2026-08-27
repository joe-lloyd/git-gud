import React from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { theme } from './theme'

// Every screen sits below the navigation header (which already clears the
// status bar / camera cutout) and above the gesture/navigation bar. Android
// 15+ draws edge-to-edge, so the bottom inset is real, not zero.
export const Screen: React.FC<{ children: React.ReactNode; style?: ViewStyle }> = ({ children, style }) => {
  const insets = useSafeAreaInsets()
  return <View style={[styles.screen, { paddingBottom: insets.bottom }, style]}>{children}</View>
}
export const Card: React.FC<{ children: React.ReactNode; onPress?: () => void; style?: ViewStyle }> = ({ children, onPress, style }) =>
  onPress ? <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { backgroundColor: theme.bgHover }, style]}>{children}</Pressable> : <View style={[styles.card, style]}>{children}</View>
export const Title: React.FC<{ children: React.ReactNode }> = ({ children }) => <Text style={styles.title}>{children}</Text>
export const Hint: React.FC<{ children: React.ReactNode }> = ({ children }) => <Text style={styles.hint}>{children}</Text>
export const Mono: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color }) => <Text style={[styles.mono, color ? { color } : null]}>{children}</Text>
export const Badge: React.FC<{ label: string; color?: string }> = ({ label, color = theme.accent }) => (
  <View style={[styles.badge, { borderColor: color + '88' }]}><Text style={[styles.badgeText, { color }]}>{label}</Text></View>
)
export const Dot: React.FC<{ status: 'connected' | 'offline' | 'connecting' | 'revoked' }> = ({ status }) => (
  <View style={[styles.dot, { backgroundColor: status === 'connected' ? theme.green : status === 'connecting' ? theme.yellow : status === 'revoked' ? theme.red : theme.textMuted }]} />
)
export const Button: React.FC<{ label: string; onPress: () => void; primary?: boolean; disabled?: boolean }> = ({ label, onPress, primary, disabled }) => (
  <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.btn, primary && styles.btnPrimary, (pressed || disabled) && { opacity: 0.6 }]}>
    <Text style={[styles.btnText, primary && { color: '#14151c' }]}>{label}</Text>
  </Pressable>
)
export const Loading: React.FC<{ label?: string }> = ({ label }) => (
  <View style={{ padding: 24, alignItems: 'center', gap: 8 }}><ActivityIndicator color={theme.accent} />{label && <Hint>{label}</Hint>}</View>
)
export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => <View style={{ padding: 24, alignItems: 'center' }}><Hint>{children}</Hint></View>

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  card: { backgroundColor: theme.bgElevated, borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius, padding: 14, marginHorizontal: 12, marginTop: 10 },
  title: { color: theme.text, fontSize: 16, fontWeight: '600' },
  hint: { color: theme.textMuted, fontSize: 12, lineHeight: 17 },
  mono: { color: theme.textSecondary, fontFamily: theme.mono, fontSize: 12 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  btn: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  btnPrimary: { backgroundColor: theme.accent, borderColor: theme.accent },
  btnText: { color: theme.text, fontWeight: '600', fontSize: 14 },
})
