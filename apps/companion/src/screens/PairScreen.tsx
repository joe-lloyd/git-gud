import React, { useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { parsePairingQr } from '@gitgud/peer-protocol'
import { Button, Card, Hint, Mono, Screen, Title } from '../ui/atoms'
import { theme } from '../ui/theme'
import { useAppState } from '../state/AppState'
import { machineFromPairing, relayAddress } from '../net/peerClient'
import type { RootStack } from '../navigation'

// Pair by QR: the payload carries address(es), certificate fingerprint and
// the one-time code, so the phone pins the certificate BEFORE its first
// request — no trust-on-first-use window, nothing to type or compare.
export const PairScreen: React.FC<NativeStackScreenProps<RootStack, 'Pair'>> = ({ navigation }) => {
  const { client, addMachine } = useAppState()
  const [perm, requestPerm] = useCameraPermissions()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')
  const [scanned, setScanned] = useState<string | null>(null)

  const pairWith = async (text: string) => {
    if (busy || !client) return
    const qr = parsePairingQr(text)
    if (!qr) { setError('Not a Git Gud pairing QR'); return }
    setBusy(true); setError('')
    try {
      const relayPeer = qr.relay ? /\/([0-9a-f]{8,64})(#|$)/.exec(qr.relay)?.[1] : undefined
      const relay = relayPeer ? relayAddress(qr.relay, relayPeer) : null
      const { address, info } = await client.probeAny([{ host: qr.host, port: qr.port }, ...(qr.alts ?? []).map((h) => ({ host: h, port: qr.port })), ...(relay ? [relay] : [])], qr.fingerprint)
      const r = await client.pair(address, qr.fingerprint, qr.code)
      const m = machineFromPairing(qr, info, r.token, r.readOnly)
      m.lastGood = address
      await addMachine(m)
      navigation.replace('Repos', { peerId: m.peerId })
    } catch (e) {
      setError(String((e as Error).message ?? e))
      setScanned(null)
    } finally { setBusy(false) }
  }

  return (
    <Screen>
      {perm?.granted ? (
        <View style={{ height: 320, margin: 12, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: theme.accentBorder }}>
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => { if (!scanned && data.startsWith('gitgud-peer://pair')) { setScanned(data); pairWith(data) } }}
          />
        </View>
      ) : (
        <Card><Title>Camera access</Title><Hint>Needed to scan the pairing QR that Git Gud shows under Settings → Share → Show QR.</Hint><View style={{ height: 10 }} /><Button primary label="Allow camera" onPress={() => requestPerm()} /></Card>
      )}
      <Card>
        <Title>{busy ? 'Pairing…' : 'Or paste the QR payload'}</Title>
        <Hint>The desktop prints it under the QR; the daemon prints it after `gitgud-headless pair --qr`.</Hint>
        <TextInput value={manual} onChangeText={setManual} placeholder="gitgud-peer://pair?v=1&h=…" placeholderTextColor={theme.textMuted} autoCapitalize="none" autoCorrect={false}
          style={{ color: theme.text, fontFamily: theme.mono, fontSize: 12, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, marginTop: 10 }} />
        <View style={{ height: 8 }} />
        <Button label="Pair" onPress={() => pairWith(manual)} disabled={busy || !manual.trim()} />
        {error && <Text style={{ color: theme.red, marginTop: 8, fontSize: 12 }}>{error}</Text>}
      </Card>
      <Card><Hint>Reachability: same Wi-Fi works out of the box. From anywhere else the phone uses the machine's relay when it has one (Settings → Reachable via relay on the desktop, "rendezvous" in the daemon config) — the QR carries the route, and machines paired before a relay existed learn it on their next check. Tailscale works too.</Hint><Mono>{''}</Mono></Card>
    </Screen>
  )
}
