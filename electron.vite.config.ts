import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Shared protocol package consumed as source so it is bundled into every
// target (no workspace symlink to break electron-builder's hoisting).
const peerProtocol = { '@gitgud/peer-protocol': resolve(__dirname, 'packages/peer-protocol/src/index.ts') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: peerProtocol },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: peerProtocol },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        ...peerProtocol,
      }
    },
    plugins: [react()],
    server: {
      port: 7779
    }
  }
})
