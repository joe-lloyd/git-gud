import React, { useEffect } from 'react'
import { StatusBar } from 'expo-status-bar'
import { DarkTheme, NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import * as Notifications from 'expo-notifications'
import { AppStateProvider, useAppState } from './src/state/AppState'
import { theme } from './src/ui/theme'
import type { RootStack } from './src/navigation'
import { MachinesScreen } from './src/screens/MachinesScreen'
import { PairScreen } from './src/screens/PairScreen'
import { ReposScreen } from './src/screens/ReposScreen'
import { RepoScreen } from './src/screens/RepoScreen'
import { CommitScreen } from './src/screens/CommitScreen'
import { DiffScreen } from './src/screens/DiffScreen'
import { registerPush } from './src/push'

const Stack = createNativeStackNavigator<RootStack>()
// Screens are typed with NativeStackScreenProps; the navigator's
// ScreenComponentType generic fights the hoisted @types/react duplicates, so
// register through one explicit cast.
const screen = (c: unknown) => c as React.ComponentType<Record<string, unknown>>

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) })

const navTheme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: theme.bg, card: theme.bgElevated, text: theme.text, primary: theme.accent, border: theme.border } }

const Root: React.FC = () => {
  const { client, machines } = useAppState()
  useEffect(() => { if (client && machines.length) registerPush(client, machines).catch(() => {}) }, [client, machines.length]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <NavigationContainer theme={navTheme} linking={{ prefixes: ['gitgud-peer://'], config: { screens: { Pair: 'pair' } } }}>
      <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: theme.bgElevated }, headerTintColor: theme.text, headerTitleStyle: { fontWeight: '600' }, contentStyle: { backgroundColor: theme.bg } }}>
        <Stack.Screen name="Machines" component={screen(MachinesScreen)} options={{ title: 'Git Gud' }} />
        <Stack.Screen name="Pair" component={screen(PairScreen)} options={{ title: 'Pair a machine' }} />
        <Stack.Screen name="Repos" component={screen(ReposScreen)} />
        <Stack.Screen name="Repo" component={screen(RepoScreen)} />
        <Stack.Screen name="Commit" component={screen(CommitScreen)} />
        <Stack.Screen name="Diff" component={screen(DiffScreen)} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}

export default function App() {
  return (
    <AppStateProvider>
      <StatusBar style="light" />
      <Root />
    </AppStateProvider>
  )
}
