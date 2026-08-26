// Global type declarations for the preload-exposed gitApi
import type { GitApi, GitHubApi, ProviderApi, GerritApi, UiApi, PeerApi } from '../preload/index'

declare global {
  interface Window {
    gitApi: GitApi
    githubApi: GitHubApi
    providerApi: ProviderApi
    gerritApi: GerritApi
    uiApi: UiApi
    peerApi: PeerApi
  }
}
