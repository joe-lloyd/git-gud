// Persistent state: paired machines (with bearer tokens → SecureStore) and
// this phone's identity. Everything is keyed so a lost phone can be revoked
// on each host independently (Settings → Paired devices → Revoke).
import * as SecureStore from 'expo-secure-store'
import type { Machine, Self } from '../net/peerClient'
import { newSelf } from '../net/peerClient'

const KEY_SELF = 'gitgud.self'
const KEY_MACHINES = 'gitgud.machines'

export async function loadSelf(deviceName: string): Promise<Self> {
  const raw = await SecureStore.getItemAsync(KEY_SELF)
  if (raw) { try { return JSON.parse(raw) as Self } catch { /* regenerate */ } }
  const s = newSelf(deviceName)
  await SecureStore.setItemAsync(KEY_SELF, JSON.stringify(s))
  return s
}

export async function loadMachines(): Promise<Machine[]> {
  const raw = await SecureStore.getItemAsync(KEY_MACHINES)
  if (!raw) return []
  try { return JSON.parse(raw) as Machine[] } catch { return [] }
}

export async function saveMachines(ms: Machine[]): Promise<void> {
  await SecureStore.setItemAsync(KEY_MACHINES, JSON.stringify(ms))
}
