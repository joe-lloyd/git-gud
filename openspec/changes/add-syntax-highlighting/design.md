## Context

`DiffViewer` parses unified diff output into typed rows (`add` / `remove` / `context` / `hunk` / `header`) and renders each row's text in a `<td className="diff-content">`. Word-diff mode does the same with token runs inside the row. `ConflictEditor` renders each side as a list of `<button>` rows in a `SidePane`, plus a plain `<textarea>` for the resolved buffer.

Today all of this is plain text. The user has asked for syntax-highlighted display of file content, scoped to common languages now and expandable later. The Hypersolid org defaults push us toward minimal deps, careful install (`--ignore-scripts`, release-age gate), and keeping the install surface boring.

This is a renderer-only concern. No main-process changes, no preload IPC changes, no Electron sandboxing issues — highlight runs inline on already-fetched diff strings.

## Goals / Non-Goals

**Goals:**
- Tokenize the actual code content of diff rows and conflict-side rows by language, derived from file extension.
- Initial language set: `txt`, `env`, `js`, `jsx`, `ts`, `tsx`, `json`, `sh`, `css`, `scss`, `sass`, `go`. `txt` and unknown extensions render as plain text.
- Bundle size stays small — only the languages we register get pulled in.
- No regression: `+` / `-` row backgrounds, line numbers, hunk headers, chunk buttons, word-diff runs all keep working.
- Architecture admits new languages by editing a single registry — no callsite changes.

**Non-Goals:**
- Highlighting the resolved-editor `<textarea>` (would need a real editor surface like CodeMirror — too big a change for this proposal).
- Auto-detection by content sniffing (`hljs.highlightAuto`). Slower, less predictable, easy to surprise the user.
- Theme switching beyond a single dark theme matched to the existing diff palette.
- Highlighting diff metadata (headers, hunk `@@` lines). Those stay literal.

## Decisions

### 1. Library: `highlight.js`

**Picked** over Shiki, Prism, and CodeMirror's stream parser.

- `highlight.js` — single dep, 200+ langs, can import per-language ESM (`highlight.js/lib/languages/typescript`) so tree-shaking keeps only what's registered. Mature, well-tested, no native bindings.
- Shiki — VSCode-grade fidelity via TextMate grammars, but heavy (WASM runtime + grammar JSON), async API, awkward to slot into a synchronous React render. Overkill for a diff viewer.
- Prism — viable, similar API surface, but its plugin / language autoloader is built around `<script>` tag injection in browsers; ESM story is rougher in a Vite + Electron renderer.
- CodeMirror parser — would only be worthwhile if we were also adopting CM as an editor for the resolved buffer. Non-goal here.

One dep, one stylesheet, low ceremony. Easy to swap later if Shiki becomes worth it.

### 2. Language resolution: extension → id map, no auto-detect

A single `extToLanguage` map in `src/renderer/lib/highlight.ts`:

```ts
{
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  json: 'json',
  sh: 'bash', bash: 'bash', zsh: 'bash', env: 'bash',  // .env close-enough to shell
  css: 'css', scss: 'scss', sass: 'scss',
  go: 'go',
  txt: null,  // explicit plain
}
```

`null` (and any unmapped extension) → render as plain text. `.env` reuses bash because dotenv assignments lex cleanly as shell `VAR=value` and there's no dedicated dotenv grammar in highlight.js — close enough for color cues, not worth a custom grammar.

### 3. Line-aware highlighting

`highlight.js` highlights a whole string at once and returns HTML where `<span>` tags wrap tokens and `\n` characters stay as plain text between them. A diff renders one row per line, so we need a per-line HTML fragment with the same coloring as if we'd highlighted the whole file.

Algorithm in `highlightLines(text: string, lang: string | null): string[]`:

1. If `lang` is `null` or unregistered → return `text.split('\n')` HTML-escaped.
2. Otherwise call `hljs.highlight(text, { language: lang }).value` (HTML).
3. Split the HTML by `\n` characters that are at depth 0 relative to `<span>` nesting. For each split, prepend any unclosed open `<span>` tags from earlier lines and append matching closers — so each line is a valid HTML fragment that colors correctly on its own. This is a well-known pattern (the highlight.js wiki documents it).

Wrap the result in `<code>` per row and inject via `dangerouslySetInnerHTML`. The HTML produced by `hljs.highlight` is from a fixed grammar over the input — no untrusted DOM is built — but we still HTML-escape any text on the no-highlight path.

For diff rows we highlight only the **content** of the line (i.e. `text.slice(1)` for `+`/`-`/context). The leading `+`/`-`/space stays outside the highlighted span so row backgrounds and the `+`/`-` sign cell continue to drive add/remove styling.

We highlight per **side**, not per row in isolation:

- For the diff: compose two virtual files — old side (header + context + removed lines, in order) and new side (header + context + added lines). Highlight each as one string with `highlightLines`. Map the result back to the row array.
- For the conflict side panes: each pane already exposes a `fullText` — highlight it once and map line-by-line.

Per-side highlighting is what makes the result look correct around strings/comments that span multiple lines. Highlighting each line in isolation would mis-color the rest of a JSDoc block after a `*/` lands on a line by itself.

### 4. Word-diff mode

Word-diff rows are sequences of `add` / `rem` / `ctx` runs concatenated to form a logical line. Two acceptable behaviors:

- **A — keep highlight off in word-diff.** Trivial.
- **B — highlight the assembled logical line, then re-segment the highlighted HTML by the original run boundaries.**

Picked **A**. Word-diff and syntax highlight both attack the same problem (showing where the change is). Stacking them double-paints the row and the run mapping (option B) is fiddly. The word-diff toggle simply turns syntax highlight off while active. Cheap to revisit later.

### 5. Bundling registered languages only

`src/renderer/lib/highlight.ts` imports the `highlight.js` core (`highlight.js/lib/core`) and explicit language modules (`highlight.js/lib/languages/typescript`, etc.). It never imports the omnibus `highlight.js` entry. Vite/Rollup tree-shakes everything else.

A small `registerLanguages()` function called at module-load time wires the extension map to registered languages. Adding a language later = one import + one map entry.

### 6. Theme

Import one theme stylesheet from `highlight.js/styles/*.css` (probably `github-dark` or `atom-one-dark`) and scope it via the existing dark theme. No runtime theme switch; the app currently has a single dark theme.

## Risks / Trade-offs

- **[Whole-side highlighting cost on huge diffs]** → Two passes per file: old side + new side. For an N-line diff this is O(N) tokenization. Already negligible against the IPC + git-diff time. If a pathological case shows up, we cap by file size (>500 KB → fall back to plain text).
- **[Highlight HTML rendered via `dangerouslySetInnerHTML`]** → `hljs.highlight` only emits a closed set of `<span class="hljs-…">` tags from its grammar. Input is the diff string from `git`, which is the file content the user already has on disk. Risk is low, but we still wrap usage in a tiny helper to make the surface auditable.
- **[Word-diff users lose highlight]** → Acceptable; documented in the requirement spec. Can revisit if it turns out users want both at once.
- **[`.env` highlighted as bash]** → False positives possible (e.g. `KEY=val#with#hashes` colored as comment). Acceptable for v1 — colored "wrong" is still cheaper to read than uncolored. Easy to swap to a custom grammar later.
- **[Initial bundle grows by `highlight.js` core + ~12 grammars]** → Expect ~30–60 KB minified gzipped for what we register. Reviewed pre-merge against `pnpm build` output.
