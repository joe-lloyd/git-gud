# syntax-highlighting Specification

## Purpose
TBD - created by archiving change add-syntax-highlighting. Update Purpose after archive.
## Requirements
### Requirement: Extension-based language resolution

The system SHALL map a file path's extension to a language identifier used for syntax highlighting. The initial supported set SHALL include: JavaScript (`.js`, `.mjs`, `.cjs`, `.jsx`), TypeScript (`.ts`, `.tsx`), JSON (`.json`), Shell (`.sh`, `.bash`, `.zsh`, `.env`), CSS (`.css`), SCSS / Sass (`.scss`, `.sass`), and Go (`.go`). Plain text (`.txt`) and any unmapped extension SHALL resolve to "no highlight" and render as plain text.

#### Scenario: Recognized extension maps to language
- **WHEN** the resolver is called with `src/foo/bar.tsx`
- **THEN** it returns the TypeScript language identifier registered with the highlighter

#### Scenario: Unknown extension falls back to plain text
- **WHEN** the resolver is called with `notes.md` (not in the supported set)
- **THEN** it returns `null` and the renderer treats the content as plain text

#### Scenario: `.env` is highlighted as shell
- **WHEN** the resolver is called with `.env`
- **THEN** it returns the Bash language identifier

#### Scenario: Case-insensitive extension match
- **WHEN** the resolver is called with `Main.GO`
- **THEN** it returns the Go language identifier

### Requirement: Line-aware highlighting helper

The system SHALL expose a helper that takes a multi-line string and a language identifier and returns one HTML fragment per input line, such that each fragment is self-contained (any `<span>` opened on a prior line is reopened on the next line and properly closed). When the language identifier is `null` or unregistered, the helper SHALL return one HTML-escaped fragment per line with no markup.

#### Scenario: Multi-line tokens are split per line
- **WHEN** the helper is called with a multi-line block comment (e.g. `/* line1\n   line2 */`) in a registered language
- **THEN** each returned fragment is independently valid HTML and renders the comment color across both lines

#### Scenario: Unknown language returns escaped plain text
- **WHEN** the helper is called with `null` as the language and content containing `<script>`
- **THEN** the returned fragment for that line contains the literal text `&lt;script&gt;` with no `<span>` tags

#### Scenario: Empty input returns empty array
- **WHEN** the helper is called with the empty string
- **THEN** it returns `['']`

### Requirement: DiffViewer integration

`DiffViewer` SHALL render the content portion (excluding the leading `+`, `-`, or space) of each `add`, `remove`, and `context` row using the line-aware highlighter, with the language resolved from `filePath`. Hunk headers, the `+` / `-` sign cell, line-number gutters, row backgrounds, and chunk action buttons SHALL remain unchanged. When the file's extension does not resolve to a registered language, rows SHALL render exactly as before this change.

#### Scenario: TypeScript file shows highlighted content
- **WHEN** a `.ts` file is opened in `DiffViewer`
- **THEN** keywords, strings, and comments in each row's content cell are wrapped in `hljs-*` token classes

#### Scenario: Unsupported extension renders unchanged
- **WHEN** a `.bin` file is opened in `DiffViewer`
- **THEN** row content renders as plain text with no `hljs-*` classes

#### Scenario: Diff sign and gutters remain literal
- **WHEN** an `add` row is rendered for a highlighted file
- **THEN** the sign cell contains the literal `+` and the gutter cell contains the line number, neither inside any `hljs-*` span

#### Scenario: Multi-line strings color consistently across rows
- **WHEN** a TypeScript diff includes a template literal that spans three context rows
- **THEN** all three rows render the literal in the string token color

### Requirement: ConflictEditor side-pane integration

`ConflictEditor`'s Current and Incoming side panes SHALL render each line's text using the line-aware highlighter with the language resolved from `filePath`. Conflict-region highlighting (`ce-side-line-conflict`) and click-to-insert behavior SHALL remain unchanged. The resolved `<textarea>` SHALL remain plain text in this change.

#### Scenario: Highlighted side panes
- **WHEN** the conflict editor opens for a `.go` file
- **THEN** both side panes render highlighted Go content while preserving the conflict-region row backgrounds

#### Scenario: Resolved editor stays plain
- **WHEN** the conflict editor opens for any supported language
- **THEN** the resolved-buffer `<textarea>` contains plain text with no highlighting markup

#### Scenario: Clicking a highlighted line still inserts plain text
- **WHEN** a user clicks a highlighted line in a side pane
- **THEN** the resolved textarea receives the original line text (no HTML / no token spans) at the cursor

### Requirement: Word-diff mode disables highlighting

When `DiffViewer` is in word-diff mode, syntax highlighting SHALL be disabled and rows SHALL render using the existing word-diff run markup (`<ins class="wd-add">`, `<del class="wd-rem">`).

#### Scenario: Word-diff toggle disables highlight
- **WHEN** word-diff mode is enabled in `DiffViewer`
- **THEN** no `hljs-*` classes appear in the rendered rows and word-diff runs render unchanged

### Requirement: Large-file fallback

When the diff text for a file exceeds 500 KB, highlighting SHALL be skipped and rows SHALL render as plain text. This SHALL NOT affect any other behavior of `DiffViewer`.

#### Scenario: Oversized diff renders plain
- **WHEN** a `.ts` diff string longer than 500 KB is opened
- **THEN** rows render without `hljs-*` classes and the rest of the viewer (gutters, chunks, sign) works normally

### Requirement: Bundle scope

Only languages explicitly registered with the highlighter SHALL be imported into the renderer bundle. The omnibus `highlight.js` entry SHALL NOT be imported.

#### Scenario: New language is added by registry edit only
- **WHEN** a developer adds Rust to the supported set
- **THEN** the change is limited to (a) importing `highlight.js/lib/languages/rust`, (b) registering it in the highlight module, and (c) extending the extension map — with no edits to `DiffViewer` or `ConflictEditor`

