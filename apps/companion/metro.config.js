// Metro must see the shared protocol package (a workspace sibling) and the
// hoisted node_modules at the repo root.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')
const root = path.resolve(__dirname, '../..')
const config = getDefaultConfig(__dirname)
config.watchFolders = [root]
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules'), path.resolve(root, 'node_modules')]
config.resolver.extraNodeModules = { '@gitgud/peer-protocol': path.resolve(root, 'packages/peer-protocol/src/index.ts') }
module.exports = config
