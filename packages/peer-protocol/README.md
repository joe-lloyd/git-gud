# @gitgud/peer-protocol

Pure-TypeScript definition of the Git Gud peer protocol: types (`PeerInfo`,
`PairRequest`, `RpcRequest`, `PeerEvent`…), the method allow-lists
(`READ_METHODS` / `WRITE_METHODS`), peer repo URIs, `parseHostPort`,
`isIpLiteral`, the SSE parser, the discovery beacon codec and the QR pairing
payload. No Node/Electron/Buffer imports, so the same source runs in Electron
main, the headless daemon and React Native.

Consumed as source (alias `@gitgud/peer-protocol` → `packages/peer-protocol/src/index.ts`)
so it is bundled into each app; nothing is published to a registry.
Node-only helpers (random codes/tokens, HMAC proof, constant-time compare)
live in `src/main/peer-protocol.ts`, which re-exports everything here.
