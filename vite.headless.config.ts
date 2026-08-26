import { defineConfig, type Plugin } from 'vite'
import { builtinModules } from 'module'
import { readFileSync } from 'fs'

// Bundles src/headless/main.ts → out/headless/main.js: one file, every npm
// dependency inlined (simple-git and friends), Node built-ins external.
// A build-time guard fails the build if anything drags Electron in.
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }

const noElectron = (): Plugin => ({
  name: 'headless-no-electron',
  resolveId(id) {
    if (id === 'electron') throw new Error(`headless bundle must not import "electron" (imported somewhere in the graph)`)
    return null
  },
})

export default defineConfig({
  plugins: [noElectron()],
  define: { __HEADLESS_VERSION__: JSON.stringify(pkg.version) },
  build: {
    ssr: 'src/headless/main.ts',
    outDir: 'out/headless',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: { format: 'cjs', entryFileNames: 'main.js', inlineDynamicImports: true },
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
    },
  },
  ssr: { noExternal: true, target: 'node' },
})
