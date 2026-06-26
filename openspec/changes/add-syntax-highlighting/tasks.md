## 1. Dependency & module scaffolding

- [x] 1.1 Add `highlight.js` to dependencies via `pnpm add --ignore-scripts highlight.js` (respect repo `minimumReleaseAge` default of 4320 mins / 3 days)
- [x] 1.2 Create `src/renderer/lib/highlight.ts` with `highlight.js/lib/core` import + per-language imports for: javascript, typescript, json, bash, css, scss, go
- [x] 1.3 Add `registerLanguages()` that registers each imported language with the core, called once at module load
- [x] 1.4 Import a single dark theme stylesheet from `highlight.js/styles/*.css` (e.g. `github-dark.css`) into `src/renderer/main.tsx`

## 2. Language resolver

- [x] 2.1 Implement and export `resolveLanguage(filePath: string): string | null` using a `Record<string, string | null>` extension map
- [x] 2.2 Include entries: js/mjs/cjs/jsx→javascript, ts/tsx→typescript, json→json, sh/bash/zsh/env→bash, css→css, scss/sass→scss, go→go, txt→null
- [x] 2.3 Lowercase the extension before lookup so `Main.GO` resolves correctly
- [x] 2.4 Handle dotfiles correctly (`.env` resolves to bash via the `env` key)

## 3. Line-aware highlighter

- [x] 3.1 Implement and export `highlightLines(text: string, lang: string | null): string[]`
- [x] 3.2 Plain-text path: split by `\n`, HTML-escape each line, return the array
- [x] 3.3 Highlight path: call `hljs.highlight(text, { language: lang }).value`, split by `\n` while tracking open `<span>` stack, prepend re-opens / append closes per line so each fragment is self-contained
- [x] 3.4 Guard against unregistered language ids (treat as plain text)
- [x] 3.5 Add unit tests under `src/renderer/test/highlight.test.ts` covering: extension map, unknown-extension fallback, multi-line string in TS, empty input, large-file (>500 KB) skip behavior in the integration helper

## 4. DiffViewer integration

- [x] 4.1 In `DiffViewer.tsx`, compute `lang = resolveLanguage(filePath)`
- [x] 4.2 Build two side strings from the parsed `lines` array: old side (`context` + `remove` content) and new side (`context` + `add` content), preserving order; track each row's index within its side
- [x] 4.3 Call `highlightLines(oldSide, lang)` and `highlightLines(newSide, lang)`; if `diff.length > 500_000` skip and treat as plain
- [x] 4.4 Replace `text.slice(type === 'context' ? 0 : 1)` rendering with `<code dangerouslySetInnerHTML={{ __html: html }} />` for `add` / `remove` / `context` rows
- [x] 4.5 Keep hunk header rows, the sign cell, gutters, and chunk-action buttons as plain text — no change
- [x] 4.6 Skip highlight entirely when `wordDiff` is true; render existing word-diff markup unchanged
- [x] 4.7 Add `.hljs` style scoping in `DiffViewer.css` so highlight tokens don't override row backgrounds (background stays from `.diff-line-add` / `.diff-line-remove`)

## 5. ConflictEditor integration

- [x] 5.1 In `ConflictEditor.tsx`, compute `lang = resolveLanguage(filePath)`
- [x] 5.2 Call `highlightLines(panes.current.fullText, lang)` and `highlightLines(panes.incoming.fullText, lang)`; pass per-line HTML arrays into `SidePane`
- [x] 5.3 Update `SidePane` to render `<span className="ce-side-text" dangerouslySetInnerHTML={{ __html: html }} />` and keep the existing `ce-side-line-conflict` class for the row
- [x] 5.4 Confirm the click handler still passes the original `l.text` (plain string) to `onLineClick`, not the HTML
- [x] 5.5 Leave the resolved `<textarea>` untouched — no highlight
- [x] 5.6 Add `.hljs` style scoping in `ConflictEditor.css` so conflict-region row background remains dominant

## 6. Visual checks & tests

- [x] 6.1 Run `pnpm typecheck`
- [x] 6.2 Run `pnpm test` — confirm new unit tests pass and existing tests still pass (highlight suite: 13/13 ✓; two `test/backend/git-service.test.ts` failures are pre-existing on `main`, unrelated to this change)
- [ ] 6.3 Run `pnpm dev` and manually verify: open a `.ts` diff, a `.json` diff, a `.go` diff, and a `.bin` diff (or any unmapped extension); word-diff toggles cleanly; conflict editor on a `.ts` conflict shows highlighted side panes; clicking a side line inserts plain text into the resolved buffer

## 7. Docs

- [x] 7.1 Add a short "Adding a language" section to a relevant doc (or `src/renderer/lib/highlight.ts` header comment) describing the three-line change: import, register, extension-map entry
