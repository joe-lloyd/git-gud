// Global type declarations for the preload-exposed gitApi
import type { GitApi, GitHubApi, ProviderApi, UiApi } from '../preload/index'

declare global {
  interface Window {
    gitApi: GitApi
    githubApi: GitHubApi
    providerApi: ProviderApi
    uiApi: UiApi
  }
}
