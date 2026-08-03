// Git trailer parsing for the commit-detail view. A trailer block is the
// final paragraph of the message body when every line in it looks like
// `Key: value` (with indented continuation lines folding into the previous
// trailer) — the same shape `git interpret-trailers` produces. Kept simpler
// than git's full algorithm (no 25%-mixed-block rule): a mixed final
// paragraph is treated as prose, so ordinary text is never swallowed.

export type Trailer = { key: string; value: string }

const TRAILER_LINE = /^([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.*)$/

// Split a commit message *body* (subject already removed) into the prose part
// and a trailing trailer block. Returns the body unchanged when there is no
// trailer block.
export function splitTrailers(body: string): { text: string; trailers: Trailer[] } {
  const trimmed = body.replace(/\n+$/, "")
  if (!trimmed.trim()) return { text: body, trailers: [] }

  const paragraphs = trimmed.split(/\n\s*\n/)
  const last = paragraphs[paragraphs.length - 1]
  const lines = last.split("\n")

  const trailers: Trailer[] = []
  for (const line of lines) {
    if (/^\s/.test(line) && trailers.length > 0) {
      // Indented continuation folds into the previous trailer's value.
      trailers[trailers.length - 1].value += " " + line.trim()
      continue
    }
    const m = TRAILER_LINE.exec(line)
    if (!m) return { text: body, trailers: [] }
    trailers.push({ key: m[1], value: m[2].trim() })
  }
  if (trailers.length === 0) return { text: body, trailers: [] }

  const text = paragraphs.slice(0, -1).join("\n\n")
  return { text, trailers }
}

// Newest local commit carrying this Change-Id. `commits` comes from the log,
// which is ordered newest-first, so the first match is the newest.
export function findCommitByChangeId(
  commits: Array<{ sha: string; changeId?: string }>,
  changeId: string,
): string | null {
  return commits.find((c) => c.changeId === changeId)?.sha ?? null
}
