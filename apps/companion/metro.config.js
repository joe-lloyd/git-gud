// Metro must see the shared protocol package (a workspace sibling) and the
// hoisted node_modules at the repo root.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')
const root = path.resolve(__dirname, '../..')
const config = getDefaultConfig(__dirname)
config.watchFolders = [root]
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules'), path.resolve(root, 'node_modules')]
config.resolver.extraNodeModules = { '@gitgud/peer-protocol': path.resolve(root, 'packages/peer-protocol/src/index.ts') }

// One React, one scheduler. The desktop app at the repo root hoists React 18,
// so pnpm nests separate React 19 copies under react-native, @react-navigation,
// expo-* … Any component rendered by a different copy than the renderer's
// fails with "Cannot read property 'useState' of null" (v1.14.0 crashed on
// launch this way). Force every `react`, `react/*` and `scheduler` request to
// a single physical copy.
const PIN = {
  react: path.dirname(require.resolve('react/package.json', { paths: [__dirname] })),
  scheduler: path.dirname(require.resolve('scheduler/package.json', { paths: [path.resolve(root, 'node_modules/react-native')] })),
}
const defaultResolve = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const m = moduleName.match(/^(react|scheduler)(\/.*)?$/)
  if (m) {
    const target = path.join(PIN[m[1]], m[2] || '')
    return (defaultResolve || context.resolveRequest)(context, target, platform)
  }
  return (defaultResolve || context.resolveRequest)(context, moduleName, platform)
}
module.exports = config
