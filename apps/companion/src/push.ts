// Expo push registration: asks for permission, gets the Expo push token and
// subscribes it on every paired host that has push enabled. Hosts that have
// push off answer 403 — that is fine, we just skip them.
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import type { PeerClient, Machine } from './net/peerClient'

export async function registerPush(client: PeerClient, machines: Machine[]): Promise<{ token: string | null; subscribed: string[] }> {
  if (!Device.isDevice) return { token: null, subscribed: [] }
  const perm = await Notifications.getPermissionsAsync()
  const status = perm.granted ? perm : await Notifications.requestPermissionsAsync()
  if (!status.granted) return { token: null, subscribed: [] }
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('gitgud', { name: 'Git Gud', importance: Notifications.AndroidImportance.DEFAULT, lightColor: '#ff79c6' })
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data
  const subscribed: string[] = []
  for (const m of machines) {
    try { await client.subscribePush(m, token, ['repo-changed']); subscribed.push(m.peerId) } catch { /* host has push off */ }
  }
  return { token, subscribed }
}
