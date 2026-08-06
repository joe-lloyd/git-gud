import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useToasts } from '../Toast/Toast'
import { resolveLanguage, highlightLines } from '../../lib/highlight'
import { Icon } from '../Icons/Icon'
import './DiffViewer.css'

// Files larger than this skip syntax highlighting — tokenization scales with
// length and the visual win is small on huge diffs.
const HIGHLIGHT_MAX_BYTES = 500_000

interface DiffViewerProps {
  filePath: string
  /** Working-tree mode: read against index. Ignored when `sha` is set. */
  staged?: boolean
  /** Commit mode: show the diff this commit introduced for `filePath`. */
  sha?: string | null
  onClose: () => void
  /** Working-tree mode only: re-fetched after a stage/unstage chunk applies. */
  onApplied?: () => void
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ filePath, staged = false, sha = null, onClose, onApplied }) => {
  const [diff, setDiff] = useState<string>('')
  const [loading, setLoading] = useState(true)
  // Discard is destructive — first click arms the button on that hunk, second
  // click within 3s commits. Auto-disarms when the hunk index changes or on
  // timeout. Keeps the inline UI without a separate modal.
  const [discardArmed, setDiscardArmed] = useState<number | null>(null)
  // Word-diff toggle — re-fetches with --word-diff=porcelain when on. Disables
  // stage/discard per-hunk and per-line in this mode since the porcelain output
  // doesn't map cleanly back to the index.
  const [wordDiff, setWordDiff] = useState(false)
  const [wordDiffError, setWordDiffError] = useState<string | null>(null)
  // Ignore-whitespace (-w) — the shown hunks then no longer match the real
  // index patch, so hunk/line staging and discard are disabled while on.
  const [ignoreWs, setIgnoreWs] = useState(false)
  // Side-by-side (split) vs inline (unified) view. Session-only preference.
  const [splitView, setSplitView] = useState(false)
  // Interactive-add: keyboard-driven hunk staging (working-tree mode only).
  const [focusedHunkIdx, setFocusedHunkIdx] = useState(0)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const hunkRefs = useRef<Map<number, HTMLTableRowElement | null>>(new Map())
  const isCommitMode = sha !== null
  // Hunk/line staging & discard everywhere except commit mode. Under -w the
  // hunk's context/removed lines can differ from the target by whitespace, so
  // applyPatch adds --ignore-whitespace; the +/− content lines are verbatim
  // file lines either way. Whitespace-only changes (hidden by the view)
  // simply stay unstaged.
  const canPatch = !isCommitMode

  // Full old/new file contents for whole-file highlighting (see the highlight
  // memo). Fetched alongside the diff; null until they arrive or on failure.
  const [sources, setSources] = useState<{ oldText: string; newText: string } | null>(null)

  const refreshDiff = useCallback(() => {
    setLoading(true)
    setWordDiffError(null)
    const p = isCommitMode
      ? window.gitApi.getCommitFileDiff(sha!, filePath, { wordDiff, ignoreWhitespace: ignoreWs })
      : window.gitApi.getFileDiff(filePath, staged, { wordDiff, ignoreWhitespace: ignoreWs })
    const s = isCommitMode
      ? window.gitApi.getCommitFileDiffSources(sha!, filePath)
      : window.gitApi.getFileDiffSources(filePath, staged)
    Promise.all([p, s.catch(() => null)]).then(([d, src]) => {
      setDiff(d || '')
      setSources(src)
      setLoading(false)
    })
  }, [filePath, staged, sha, isCommitMode, wordDiff, ignoreWs])

  useEffect(() => { refreshDiff() }, [refreshDiff])

  // ── Word-diff porcelain parse ──────────────────────────────────────────────
  // Format spec (`man git-diff`):
  //   ` text`  unchanged run
  //   `+text`  added run
  //   `-text`  removed run
  //   `~`      end-of-line marker (separates logical lines)
  // Runs accumulate until `~`, at which point we emit a "wdLine" with the
  // run sequence. Headers and hunk markers stay as their own line types so
  // the layout looks consistent with line-diff mode.
  type WdRun = { kind: 'ctx' | 'add' | 'rem'; text: string }
  type WdLine =
    | { kind: 'header' | 'hunk'; text: string }
    | { kind: 'content'; runs: WdRun[]; rowKind: 'add' | 'rem' | 'mixed' | 'ctx' }
  const wordDiffLines: WdLine[] | null = useMemo(() => {
    if (!wordDiff) return null
    try {
      const out: WdLine[] = []
      let inHunk = false
      let runs: WdRun[] = []
      const flush = () => {
        let hasAdd = false, hasRem = false, hasCtx = false
        for (const r of runs) {
          if (r.kind === 'add') hasAdd = true
          else if (r.kind === 'rem') hasRem = true
          else hasCtx = true
        }
        const rowKind = hasAdd && hasRem ? 'mixed'
          : hasAdd ? 'add'
          : hasRem ? 'rem'
          : 'ctx'
        out.push({ kind: 'content', runs, rowKind })
        runs = []
      }
      for (const raw of diff.split('\n')) {
        if (raw.startsWith('@@')) { if (runs.length) flush(); inHunk = true; out.push({ kind: 'hunk', text: raw }); continue }
        if (!inHunk) { out.push({ kind: 'header', text: raw }); continue }
        if (raw === '~') { flush(); continue }
        if (raw.startsWith('+')) runs.push({ kind: 'add', text: raw.slice(1) })
        else if (raw.startsWith('-')) runs.push({ kind: 'rem', text: raw.slice(1) })
        else if (raw.startsWith(' ')) runs.push({ kind: 'ctx', text: raw.slice(1) })
        else if (raw === '') { /* trailing newline */ }
        else throw new Error(`unknown porcelain token: ${raw[0]}`)
      }
      if (runs.length) flush()
      return out
    } catch (e) {
      // Surface to the user but don't blow up — caller will fall back.
      console.warn('word-diff parse failed', e)
      return null
    }
  }, [diff, wordDiff])

  // If word-diff parse failed and we got here with wordDiff=true, fall back
  // gracefully: turn the toggle off and surface a one-shot message.
  useEffect(() => {
    if (wordDiff && diff && wordDiffLines === null && !wordDiffError) {
      setWordDiffError('Word diff parse failed — showing line diff.')
      setWordDiff(false)
    }
  }, [wordDiff, diff, wordDiffLines, wordDiffError])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Parse unified diff into typed lines with hunk bounds AND track each row's
  // line number against the original (oldNo) and new (newNo) file. Hunk
  // headers (@@ -a,b +c,d @@) reset the counters; context advances both,
  // remove advances only oldNo, add advances only newNo. "\ No newline at
  // end of file" markers don't consume a line number.
  const lang = useMemo(() => resolveLanguage(filePath), [filePath])

  const { lines, highlightHtml } = useMemo(() => {
    let currentHunkIndex = -1
    let oldCursor = 0
    let newCursor = 0
    const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
    const lines = diff.split('\n').map((text, i) => {
      let type: 'add' | 'remove' | 'hunk' | 'header' | 'context' = 'context'
      let oldNo: number | null = null
      let newNo: number | null = null

      if (currentHunkIndex === -1 && !text.startsWith('@@')) {
        type = 'header'
      } else if (text.startsWith('@@')) {
        type = 'hunk'
        currentHunkIndex = i
        const m = text.match(HUNK_RE)
        if (m) {
          oldCursor = parseInt(m[1], 10)
          newCursor = parseInt(m[2], 10)
        }
      } else if (text.startsWith('\\')) {
        // "\ No newline at end of file" — informational, no line number
        type = 'context'
      } else if (text.startsWith('+')) {
        type = 'add'
        newNo = newCursor++
      } else if (text.startsWith('-')) {
        type = 'remove'
        oldNo = oldCursor++
      } else if (currentHunkIndex !== -1) {
        type = 'context'
        oldNo = oldCursor++
        newNo = newCursor++
      }

      return { text, type, i, hunkIndex: currentHunkIndex, oldNo, newNo }
    })

    // Build per-row highlighted HTML when we have a registered language.
    // Word-diff and oversized inputs skip highlighting entirely (tokenizing
    // megabytes in the renderer thread is wasteful and the value marginal).
    const html = new Map<number, string>()
    const srcBytes = sources ? sources.oldText.length + sources.newText.length : 0
    const skip = wordDiff || lang === null || diff.length > HIGHLIGHT_MAX_BYTES || srcBytes > HIGHLIGHT_MAX_BYTES
    if (!skip && sources) {
      // Preferred path: highlight the COMPLETE old/new files, then pick each
      // row's fragment by its line number. Hunk excerpts alone misrender
      // multi-line tokens — a block comment opened above the hunk (or left
      // unclosed inside it) would paint everything after it as comment.
      const oldHtml = highlightLines(sources.oldText, lang)
      const newHtml = highlightLines(sources.newText, lang)
      for (const l of lines) {
        // Context rows prefer the new side so additions/context align tonally.
        if (l.newNo !== null && newHtml[l.newNo - 1] !== undefined) html.set(l.i, newHtml[l.newNo - 1])
        else if (l.oldNo !== null && oldHtml[l.oldNo - 1] !== undefined) html.set(l.i, oldHtml[l.oldNo - 1])
      }
    } else if (!skip) {
      // Fallback (sources unavailable): highlight the excerpt streams. Multi-
      // line tokens crossing hunk borders may misrender here.
      const oldText: string[] = []
      const newText: string[] = []
      const oldRowIdx: number[] = []
      const newRowIdx: number[] = []
      for (const l of lines) {
        if (l.type === 'context') {
          oldText.push(l.text.slice(1)); oldRowIdx.push(l.i)
          newText.push(l.text.slice(1)); newRowIdx.push(l.i)
        } else if (l.type === 'remove') {
          oldText.push(l.text.slice(1)); oldRowIdx.push(l.i)
        } else if (l.type === 'add') {
          newText.push(l.text.slice(1)); newRowIdx.push(l.i)
        }
      }
      const oldHtml = highlightLines(oldText.join('\n'), lang)
      const newHtml = highlightLines(newText.join('\n'), lang)
      for (let k = 0; k < oldRowIdx.length; k++) html.set(oldRowIdx[k], oldHtml[k] ?? '')
      for (let k = 0; k < newRowIdx.length; k++) html.set(newRowIdx[k], newHtml[k] ?? '')
    }

    return { lines, highlightHtml: html }
  }, [diff, lang, wordDiff, sources])

  // Pair the unified lines into side-by-side rows: context spans both columns;
  // runs of removes/adds within a hunk are zipped (remove[k] ↔ add[k]) so a
  // modified line shows old-vs-new aligned, with extras on one side.
  type ParsedLine = typeof lines[number]
  type SxsRow =
    | { kind: 'full'; line: ParsedLine }
    | { kind: 'pair'; left: ParsedLine | null; right: ParsedLine | null }
  const sideBySideRows: SxsRow[] = useMemo(() => {
    const rows: SxsRow[] = []
    let rem: ParsedLine[] = []
    let add: ParsedLine[] = []
    const flush = () => {
      const n = Math.max(rem.length, add.length)
      for (let k = 0; k < n; k++) rows.push({ kind: 'pair', left: rem[k] ?? null, right: add[k] ?? null })
      rem = []; add = []
    }
    for (const l of lines) {
      if (l.type === 'remove') { rem.push(l); continue }
      if (l.type === 'add') { add.push(l); continue }
      flush()
      if (l.type === 'context') rows.push({ kind: 'pair', left: l, right: l })
      else rows.push({ kind: 'full', line: l }) // header / hunk
    }
    flush()
    return rows
  }, [lines])

  const toast = useToasts()
  const [applyError, setApplyError] = useState<string | null>(null)

  // cached=true → index (stage/unstage). cached=false → working tree (discard).
  // reverse undoes the patch direction, used for unstage and for discard.
  const applyPatch = async (patch: string, opts: { cached: boolean; reverse: boolean }) => {
    if (!canPatch) return
    setLoading(true)
    setApplyError(null)
    const r = await window.gitApi.applyPatch(patch, { ...opts, ignoreWhitespace: ignoreWs })
    if (r.success) {
      onApplied?.()
    } else {
      // Surface the underlying `git apply` error so users see why the chunk
      // didn't stage (most common cause: hunk context drift after an earlier
      // partial stage). Banner stays until the next refresh.
      const msg = (r.error || 'apply failed').replace(/^Error:\s*/i, '').trim()
      setApplyError(msg)
      toast.error(opts.cached ? (opts.reverse ? 'Unstage failed' : 'Stage failed') : 'Discard failed', msg)
    }
    refreshDiff()
  }

  // Build a patch containing the whole hunk at `hunkStart`. Used for both
  // stage/unstage and discard — the destination just differs in `opts`.
  const buildChunkPatch = (hunkStart: number): string => {
    const patchLines = lines.filter(l => l.type === 'header').map(l => l.text)
    for (let i = hunkStart; i < lines.length; i++) {
      if (i > hunkStart && lines[i].type === 'hunk') break
      // Skip the trailing empty string from diff.split('\n') so we don't emit
      // an extra context line that git apply may reject.
      if (i === lines.length - 1 && lines[i].text === '') continue
      patchLines.push(lines[i].text)
    }
    return patchLines.join('\n') + '\n'
  }

  // Build a single-line patch — flips the other +/- lines back to context so
  // the hunk still applies cleanly with just `targetIdx` taking effect.
  const buildLinePatch = (hunkStart: number, targetIdx: number): string => {
    const patchLines = lines.filter(l => l.type === 'header').map(l => l.text)
    for (let i = hunkStart; i < lines.length; i++) {
      if (i > hunkStart && lines[i].type === 'hunk') break
      if (i === lines.length - 1 && lines[i].text === '') continue
      const l = lines[i]
      if (l.type === 'hunk' || i === targetIdx) patchLines.push(l.text)
      else if (l.type === 'context') patchLines.push(l.text)
      else if (l.type === 'remove') patchLines.push(' ' + l.text.slice(1))
    }
    return patchLines.join('\n') + '\n'
  }

  const handleStageChunk = (hunkStart: number) => {
    applyPatch(buildChunkPatch(hunkStart), { cached: true, reverse: staged })
  }
  const handleStageLine = (hunkStart: number, targetIdx: number) => {
    applyPatch(buildLinePatch(hunkStart, targetIdx), { cached: true, reverse: staged })
  }

  // Line indices of each hunk header — the keyboard-navigable hunk list.
  const hunkStarts = useMemo(() => lines.filter((l) => l.type === 'hunk').map((l) => l.i), [lines])

  // The whole file diff is itself a valid patch — used for stage/discard all.
  const buildAllPatch = () => lines.map((l) => l.text).join('\n') + '\n'
  const handleStageAll = () => applyPatch(buildAllPatch(), { cached: true, reverse: staged })

  const handleDiscardLine = (hunkStart: number, targetIdx: number) => {
    applyPatch(buildLinePatch(hunkStart, targetIdx), { cached: false, reverse: true })
    if (staged) applyPatch(buildLinePatch(hunkStart, targetIdx), { cached: true, reverse: true })
  }

  // Discard-all uses the same two-step arm, keyed by a -1 sentinel.
  const handleDiscardAll = () => {
    if (discardArmed !== -1) {
      setDiscardArmed(-1)
      window.setTimeout(() => setDiscardArmed((cur) => (cur === -1 ? null : cur)), 3000)
      return
    }
    setDiscardArmed(null)
    applyPatch(buildAllPatch(), { cached: false, reverse: true })
    if (staged) applyPatch(buildAllPatch(), { cached: true, reverse: true })
  }

  // Discard nukes the chunk from the working tree (unstaged) or from both
  // index + working tree (staged). Two-click confirm keeps an accident from
  // wiping work.
  const handleDiscardChunk = (hunkStart: number) => {
    if (discardArmed !== hunkStart) {
      setDiscardArmed(hunkStart)
      window.setTimeout(() => setDiscardArmed((cur) => (cur === hunkStart ? null : cur)), 3000)
      return
    }
    setDiscardArmed(null)
    // Working-tree reverse-apply throws the change away.
    applyPatch(buildChunkPatch(hunkStart), { cached: false, reverse: true })
    // If the chunk was staged, also drop it from the index so it doesn't
    // re-appear on the next refresh.
    if (staged) applyPatch(buildChunkPatch(hunkStart), { cached: true, reverse: true })
  }

  // ── Interactive-add keyboard control (working-tree, inline view) ──────────
  // j/k or arrows move the focused hunk; s/Shift+S stage; d/Shift+D discard
  // (two-step); ? toggles the shortcut overlay.
  const moveFocus = (delta: number) => {
    if (hunkStarts.length === 0) return
    const next = Math.max(0, Math.min(hunkStarts.length - 1, focusedHunkIdx + delta))
    setFocusedHunkIdx(next)
    hunkRefs.current.get(hunkStarts[next])?.scrollIntoView({ block: 'nearest' })
  }
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!canPatch) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
    if (e.key === '?') { e.preventDefault(); setShowShortcuts((v) => !v); return }
    if (hunkStarts.length === 0) return
    const focused = hunkStarts[Math.min(focusedHunkIdx, hunkStarts.length - 1)]
    switch (e.key) {
      case 'j': case 'ArrowDown': e.preventDefault(); moveFocus(1); break
      case 'k': case 'ArrowUp':   e.preventDefault(); moveFocus(-1); break
      case 's': e.preventDefault(); handleStageChunk(focused); break
      case 'S': e.preventDefault(); handleStageAll(); break
      case 'd': e.preventDefault(); handleDiscardChunk(focused); break
      case 'D': e.preventDefault(); handleDiscardAll(); break
    }
  }

  // Deliberately NO autofocus on open: selecting a file in the working-tree
  // list must keep keyboard focus in that list so arrows keep traversing
  // files. Click into the diff to use the hunk shortcuts (j/k/s/d).
  // Clamp the focused hunk if the diff shrank.
  useEffect(() => {
    if (focusedHunkIdx >= hunkStarts.length) setFocusedHunkIdx(Math.max(0, hunkStarts.length - 1))
  }, [hunkStarts.length, focusedHunkIdx])

  return (
    <div
      className="diff-viewer fade-in"
      ref={bodyRef}
      tabIndex={canPatch ? 0 : undefined}
      onKeyDown={handleKeyDown}
    >
      {/* Header bar */}
      <div className="diff-header">
        <span className="diff-header-label">
          {isCommitMode ? (
            <span className="diff-badge diff-badge-commit mono">{sha!.slice(0, 7)}</span>
          ) : (
            <span className={`diff-badge ${staged ? 'diff-badge-staged' : 'diff-badge-unstaged'}`}>
              {staged ? 'Staged' : 'Unstaged'}
            </span>
          )}
          <span className="diff-filename">{filePath}</span>
        </span>
        <button
          className={`diff-toggle ${splitView ? 'on' : ''}`}
          onClick={() => setSplitView((v) => !v)}
          disabled={wordDiff}
          title={wordDiff ? 'Turn off Word diff to use split view' : 'Toggle side-by-side view'}
        >
          {splitView ? 'Inline' : 'Side-by-side'}
        </button>
        <button
          className={`diff-toggle ${wordDiff ? 'on' : ''}`}
          onClick={() => setWordDiff((v) => !v)}
          title="Toggle word-level diff"
        >
          Word diff
        </button>
        <button
          className={`diff-toggle ${ignoreWs ? 'on' : ''}`}
          onClick={() => setIgnoreWs((v) => !v)}
          title={ignoreWs
            ? 'Showing diff with whitespace-only changes hidden (git diff -w). Staging a chunk stages its content changes; hidden whitespace-only changes stay unstaged.'
            : 'Hide whitespace-only changes (git diff -w)'}
        >
          Ignore whitespace
        </button>
        {canPatch && (
          <button
            className={`diff-toggle ${showShortcuts ? 'on' : ''}`}
            onClick={() => setShowShortcuts((v) => !v)}
            title="Keyboard shortcuts"
          >
            ?
          </button>
        )}
        <button className="diff-close" onClick={onClose} title="Close diff (Esc)"><Icon name="x" size={12} /> Close</button>
      </div>
      {showShortcuts && canPatch && (
        <div className="diff-shortcuts">
          <div className="diff-shortcuts-title">Hunk shortcuts</div>
          <ul>
            <li><kbd>j</kbd>/<kbd>k</kbd> or <kbd>↓</kbd>/<kbd>↑</kbd> — move focused hunk</li>
            <li><kbd>s</kbd> — {staged ? 'unstage' : 'stage'} focused hunk · <kbd>⇧S</kbd> — all hunks</li>
            <li><kbd>d</kbd> — discard focused hunk (press twice) · <kbd>⇧D</kbd> — all</li>
            <li><kbd>Alt</kbd>+click a +/− sign — discard that single line</li>
            <li><kbd>?</kbd> — toggle this panel</li>
          </ul>
        </div>
      )}
      {wordDiffError && <div className="diff-banner">{wordDiffError}</div>}
      {applyError && <div className="diff-banner diff-banner-error">git apply: {applyError}</div>}

      {/* Diff body */}
      {loading ? (
        <div className="diff-loading">Loading diff…</div>
      ) : diff.trim() === '' ? (
        <div className="diff-loading">
          {ignoreWs
            ? 'No changes left to show — the differences are whitespace-only (or the file is untracked). Turn off "Ignore whitespace" to see them.'
            : 'No diff available for this file.'}
        </div>
      ) : wordDiff && wordDiffLines ? (
        <div className="diff-body">
          <table className="diff-table diff-table-word">
            <tbody>
              {wordDiffLines.map((l, i) => {
                if (l.kind === 'header') {
                  return (
                    <tr key={i} className="diff-line diff-line-header">
                      <td className="diff-content" colSpan={3}>{l.text}</td>
                    </tr>
                  )
                }
                if (l.kind === 'hunk') {
                  return (
                    <tr key={i} className="diff-line diff-line-hunk">
                      <td className="diff-content" colSpan={3}>{l.text}</td>
                    </tr>
                  )
                }
                return (
                  <tr key={i} className={`diff-line diff-line-${l.rowKind === 'add' ? 'add' : l.rowKind === 'rem' ? 'remove' : 'context'}`}>
                    <td className="diff-content" colSpan={3}>
                      {l.runs.map((r, j) => {
                        if (r.kind === 'add') return <ins key={j} className="wd-add">{r.text}</ins>
                        if (r.kind === 'rem') return <del key={j} className="wd-rem">{r.text}</del>
                        return <span key={j}>{r.text}</span>
                      })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : splitView ? (
        <div className="diff-body">
          <table className="diff-table diff-table-sxs">
            <tbody>
              {sideBySideRows.map((row, ri) => {
                if (row.kind === 'full') {
                  const { text, type, i } = row.line
                  return (
                    <tr key={ri} className={`diff-line diff-line-${type}`}>
                      <td className="diff-content" colSpan={4}>
                        {text}
                        {type === 'hunk' && canPatch && (
                          <span className="diff-chunk-actions">
                            <button className="diff-chunk-btn" onClick={() => handleStageChunk(i)}>
                              {staged ? <>Unstage chunk <Icon name="arrow-up" size={11} /></> : <>Stage chunk <Icon name="arrow-down" size={11} /></>}
                            </button>
                            <button
                              className={`diff-chunk-btn diff-chunk-btn-danger ${discardArmed === i ? 'armed' : ''}`}
                              onClick={() => handleDiscardChunk(i)}
                              title={discardArmed === i ? 'Click again within 3s to confirm' : 'Discard this chunk (irreversible)'}
                            >
                              {discardArmed === i ? <>Click again to discard <Icon name="x" size={11} /></> : <>Discard chunk <Icon name="x" size={11} /></>}
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                }
                const { left, right } = row
                const cell = (l: ParsedLine | null, side: 'old' | 'new') => {
                  if (!l) return <><td className="diff-gutter diff-sxs-empty" /><td className="diff-content diff-sxs-empty" /></>
                  const html = highlightHtml.get(l.i)
                  const plain = l.text.slice(l.type === 'context' ? 0 : 1)
                  const cls = l.type === 'remove' ? 'diff-line-remove' : l.type === 'add' ? 'diff-line-add' : 'diff-line-context'
                  return (
                    <>
                      <td className={`diff-gutter diff-gutter-${side} ${cls}`}>{(side === 'old' ? l.oldNo : l.newNo) ?? ''}</td>
                      <td className={`diff-content ${cls}`}>
                        {html !== undefined
                          ? <code className="hljs diff-code" dangerouslySetInnerHTML={{ __html: html }} />
                          : plain}
                      </td>
                    </>
                  )
                }
                return (
                  <tr key={ri} className="diff-line diff-sxs-row">
                    {cell(left, 'old')}
                    {cell(right, 'new')}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="diff-body">
          <table className="diff-table">
            <tbody>
              {lines.map(({ text, type, i, hunkIndex, oldNo, newNo }) => {
                const lineActionable = canPatch && (type === 'add' || type === 'remove')
                const lineHint = lineActionable ? (staged ? 'Click to unstage · Alt-click to discard' : 'Click to stage · Alt-click to discard') : ''
                const onLineClick = lineActionable ? () => handleStageLine(hunkIndex, i) : undefined
                // Alt+click on the sign discards that single line instead of staging it.
                const onSignClick = lineActionable
                  ? (e: React.MouseEvent) => (e.altKey ? handleDiscardLine(hunkIndex, i) : handleStageLine(hunkIndex, i))
                  : undefined
                const isFocusedHunk = type === 'hunk' && i === hunkStarts[focusedHunkIdx]
                // Highlighted content is only applied to code rows (add /
                // remove / context). Hunk headers, file headers, and the
                // "No newline" marker stay literal so their diff styling
                // (italic accent hunk text, etc.) keeps control of the cell.
                const html = (type === 'add' || type === 'remove' || (type === 'context' && !text.startsWith('\\')))
                  ? highlightHtml.get(i)
                  : undefined
                const plainText = text.slice(type === 'context' ? 0 : 1)
                return (
                  <tr
                    key={i}
                    ref={type === 'hunk' ? (el) => { hunkRefs.current.set(i, el) } : undefined}
                    className={`diff-line diff-line-${type} ${lineActionable ? 'diff-line-actionable' : ''} ${isFocusedHunk ? 'focused-hunk' : ''}`}
                  >
                    {/* Gutters and the +/- sign all stage the line — wider hit target. */}
                    <td className="diff-gutter diff-gutter-old" onClick={onLineClick} title={lineHint}>{oldNo ?? ''}</td>
                    <td className="diff-gutter diff-gutter-new" onClick={onLineClick} title={lineHint}>{newNo ?? ''}</td>
                    <td className={`diff-sign ${lineActionable ? 'diff-sign-actionable' : ''}`}
                        onClick={onSignClick}
                        title={lineHint}>
                      {type === 'add' ? '+' : type === 'remove' ? '−' : ''}
                    </td>
                    <td className="diff-content">
                      {html !== undefined
                        ? <code className="hljs diff-code" dangerouslySetInnerHTML={{ __html: html }} />
                        : plainText}
                      {type === 'hunk' && canPatch && (
                        <span className="diff-chunk-actions">
                          <button className="diff-chunk-btn" onClick={() => handleStageChunk(i)}>
                            {staged ? <>Unstage chunk <Icon name="arrow-up" size={11} /></> : <>Stage chunk <Icon name="arrow-down" size={11} /></>}
                          </button>
                          <button
                            className={`diff-chunk-btn diff-chunk-btn-danger ${discardArmed === i ? 'armed' : ''}`}
                            onClick={() => handleDiscardChunk(i)}
                            title={discardArmed === i ? 'Click again within 3s to confirm' : 'Discard this chunk (irreversible)'}
                          >
                            {discardArmed === i ? <>Click again to discard <Icon name="x" size={11} /></> : <>Discard chunk <Icon name="x" size={11} /></>}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
