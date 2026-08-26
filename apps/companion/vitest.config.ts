import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
// Logic tests only (protocol client, graph lanes, hmac) — no React Native runtime.
export default defineConfig({
  resolve: { alias: { '@gitgud/peer-protocol': resolve(__dirname, '../../packages/peer-protocol/src/index.ts') } },
  test: { environment: 'node', include: ['test/**/*.test.ts'], testTimeout: 20000 },
})
