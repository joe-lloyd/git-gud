// Global type declarations for the preload-exposed gitApi
import type { GitApi, GitHubApi } from '../preload/index'

declare global {
  interface Window {
    gitApi: GitApi
    githubApi: GitHubApi
  }
}
