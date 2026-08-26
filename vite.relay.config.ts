import { defineConfig } from 'vite'
import { builtinModules } from 'module'
import { readFileSync } from 'fs'
import { resolve } from 'path'
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
// Single-file rendezvous/relay service: src/relay/main.ts → out/relay/main.js
export default defineConfig({
  resolve: { alias: { '@gitgud/peer-protocol': resolve(__dirname, 'packages/peer-protocol/src/index.ts') } },
  define: { __RELAY_VERSION__: JSON.stringify(pkg.version) },
  build: {
    ssr: 'src/relay/main.ts', outDir: 'out/relay', emptyOutDir: true, target: 'node20', minify: false, sourcemap: false,
    rollupOptions: { output: { format: 'cjs', entryFileNames: 'main.js', inlineDynamicImports: true }, external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)] },
  },
  ssr: { noExternal: true, target: 'node' },
})
