import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@gitgud/peer-protocol': resolve(__dirname, 'packages/peer-protocol/src/index.ts') } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/renderer/test/setup.ts'],
    // Integration tests spin up real git repos and run history-rewriting ops
    // (rebase, commit-tree) that exceed the 5s default when files run in
    // parallel and contend for CPU.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
