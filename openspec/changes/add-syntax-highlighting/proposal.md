## Why

DiffViewer and ConflictEditor render file content as plain monospace text. Without syntax highlighting, scanning a diff or weighing two conflict sides requires reading every token to spot intent. Color tokens (keywords, strings, comments) let the eye land on the actual change in a second instead of ten.

## What Changes

- Add syntax highlighting to `DiffViewer` (line-diff and word-diff modes).
- Add syntax highlighting to `ConflictEditor` side panes (Current / Incoming).
- Resolve target language from the file path extension, with a tight initial allowlist: `txt`, `env`, `js`, `jsx`, `ts`, `tsx`, `json`, `sh`, `css`, `scss`, `sass`, `go`.
- Files outside the allowlist render as plain text (current behavior, no regression).
- Highlighting layered on top of existing diff/conflict markup — `+`/`-`/conflict row backgrounds remain authoritative.
- Resolved textarea in `ConflictEditor` stays plain `<textarea>` (no highlighted editor — out of scope).

## Capabilities

### New Capabilities
- `syntax-highlighting`: extension → language resolution, per-line tokenization for diff rows, and rendering integration with `DiffViewer` and `ConflictEditor`.

### Modified Capabilities
<!-- None — no existing specs in openspec/specs/ -->

## Impact

- Code:
  - `src/renderer/components/DiffViewer/DiffViewer.tsx` and `.css`
  - `src/renderer/components/ConflictEditor/ConflictEditor.tsx` and `.css`
  - New module `src/renderer/lib/highlight.ts` (language registry + line-aware highlight helper).
- Dependencies: one new `highlight.js` dep (renderer-side only). Imports only registered languages to keep bundle small. Per Hypersolid defaults: `pnpm add --ignore-scripts` with the standard `minimumReleaseAge`.
- No main-process or preload changes. No IPC surface change.
- Tests: unit tests for the language resolver and the line-aware highlighter under `src/renderer/test/`.
