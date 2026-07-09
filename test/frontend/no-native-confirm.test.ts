import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// Guard: destructive confirmations must use the in-app ConfirmModal, never the
// native window.confirm / window.alert (unreliable in this Electron build — it
// caused silent no-ops). This keeps the regression from returning.

const RENDERER = join(__dirname, '..', '..', 'src', 'renderer')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : []
  })
}

describe('no native confirm/alert in the renderer', () => {
  const files = walk(RENDERER)

  it('finds renderer source files to scan', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('uses no window.confirm / window.alert (comments excluded)', () => {
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf-8')
      // Split on \r?\n — with a plain '\n' split, CRLF files leave a trailing
      // \r that stops the comment-strip regex's $ anchor from matching.
      src.split(/\r?\n/).forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '') // strip line comments
        if (/\bwindow\.(confirm|alert)\s*\(/.test(code) || /(^|[^.\w])(confirm|alert)\s*\(/.test(code) && /\bwindow\b/.test(code)) {
          offenders.push(`${f}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(offenders, `Use ConfirmModal instead:\n${offenders.join('\n')}`).toHaveLength(0)
  })
})
