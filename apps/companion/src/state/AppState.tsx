// App-wide state: this phone's identity, paired machines, one PeerClient.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as Device from 'expo-device'
import { PeerClient, type Machine, type Self } from '../net/peerClient'
import { loadMachines, loadSelf, saveMachines } from './store'
import { createTransport } from '../net/nativeTransport'

type Ctx = {
  self: Self | null
  machines: Machine[]
  client: PeerClient | null
  addMachine(m: Machine): Promise<void>
  updateMachine(peerId: string, patch: Partial<Machine>): Promise<void>
  removeMachine(peerId: string): Promise<void>
}
const C = createContext<Ctx | null>(null)

export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [self, setSelf] = useState<Self | null>(null)
  const [machines, setMachines] = useState<Machine[]>([])
  useEffect(() => {
    loadSelf(Device.deviceName ?? 'Phone').then(setSelf)
    loadMachines().then(setMachines)
  }, [])
  const client = useMemo(() => (self ? new PeerClient(createTransport(), self) : null), [self])
  const persist = useCallback(async (next: Machine[]) => { setMachines(next); await saveMachines(next) }, [])
  const addMachine = useCallback(async (m: Machine) => persist([...machines.filter((x) => x.peerId !== m.peerId), m]), [machines, persist])
  const updateMachine = useCallback(async (peerId: string, patch: Partial<Machine>) => persist(machines.map((x) => (x.peerId === peerId ? { ...x, ...patch } : x))), [machines, persist])
  const removeMachine = useCallback(async (peerId: string) => persist(machines.filter((x) => x.peerId !== peerId)), [machines, persist])
  return <C.Provider value={{ self, machines, client, addMachine, updateMachine, removeMachine }}>{children}</C.Provider>
}

export function useAppState(): Ctx {
  const c = useContext(C)
  if (!c) throw new Error('AppStateProvider missing')
  return c
}
