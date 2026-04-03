// Global type declarations for the preload-exposed gitApi
import type { GitApi } from '../preload/index'

declare global {
  interface Window {
    gitApi: GitApi
  }
}
