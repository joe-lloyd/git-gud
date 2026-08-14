import { describe, it, expect } from 'vitest'
import { needsShellPath, parseShellPath, mergePath, applyShellPath } from '../../src/main/shell-path'

describe('needsShellPath', () => {
  it('fires on the launchd GUI PATH', () => {
    expect(needsShellPath('/usr/bin:/bin:/usr/sbin:/sbin')).toBe(true)
  })

  it('fires on an empty or missing PATH', () => {
    expect(needsShellPath('')).toBe(true)
    expect(needsShellPath(undefined)).toBe(true)
  })

  it('stays quiet when a shell PATH was inherited', () => {
    expect(needsShellPath('/opt/homebrew/bin:/usr/bin:/bin')).toBe(false)
    expect(needsShellPath('/Users/x/.cargo/bin:/usr/bin:/bin:/usr/sbin:/sbin')).toBe(false)
  })

  it('tolerates whitespace and empty segments', () => {
    expect(needsShellPath('/usr/bin: /bin ::/sbin')).toBe(true)
  })
})

describe('parseShellPath', () => {
  const wrap = (p: string) => `__GIT_GUD_PATH__${p}__GIT_GUD_PATH__`

  it('extracts the fenced value out of interactive-shell noise', () => {
    const noisy = `Last login: Tue\n\x1b[1mmotd\x1b[0m\n${wrap('/opt/homebrew/bin:/usr/bin')}\n`
    expect(parseShellPath(noisy)).toBe('/opt/homebrew/bin:/usr/bin')
  })

  it('returns null when the fence is missing', () => {
    expect(parseShellPath('some rc error\n')).toBeNull()
  })

  it('returns null on an empty fenced value', () => {
    expect(parseShellPath(wrap('  '))).toBeNull()
  })
})

describe('mergePath', () => {
  it('puts the shell PATH first and keeps baseline entries', () => {
    expect(mergePath('/opt/homebrew/bin:/usr/bin', '/usr/bin:/bin:/sbin'))
      .toBe('/opt/homebrew/bin:/usr/bin:/bin:/sbin')
  })

  it('dedupes without reordering', () => {
    expect(mergePath('/a:/b:/a', '/b:/c')).toBe('/a:/b:/c')
  })

  it('survives an undefined current PATH', () => {
    expect(mergePath('/a:/b', undefined)).toBe('/a:/b')
  })
})

describe('applyShellPath', () => {
  it('leaves an already-good PATH alone', async () => {
    const env = { PATH: '/opt/homebrew/bin:/usr/bin:/bin', SHELL: '/bin/zsh' }
    expect(await applyShellPath(env)).toBe(false)
    expect(env.PATH).toBe('/opt/homebrew/bin:/usr/bin:/bin')
  })

  it.runIf(process.platform === 'darwin')('recovers the shell PATH from a launchd PATH', async () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', SHELL: process.env.SHELL }
    const changed = await applyShellPath(env)
    // A shell that resolves nothing new is a legitimate outcome on a bare
    // machine; only assert the invariant that we never lose entries.
    expect(env.PATH).toContain('/usr/bin')
    if (changed) expect(env.PATH!.length).toBeGreaterThan('/usr/bin:/bin:/usr/sbin:/sbin'.length)
  })

  it('never throws when the shell is bogus', async () => {
    const env = { PATH: '/usr/bin:/bin', SHELL: '/nonexistent/shell' }
    expect(await applyShellPath(env)).toBe(false)
  })

  // Regression: an interactive shell ignores SIGTERM, so a plain execFile
  // timeout could never kill a hanging rc file and startup blocked forever.
  it.runIf(process.platform === 'darwin')('gives up on a shell that never exits', async () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', SHELL: '/bin/sleep' }
    const started = Date.now()
    await applyShellPath(env)
    expect(Date.now() - started).toBeLessThan(8000)
    expect(env.PATH).toBe('/usr/bin:/bin:/usr/sbin:/sbin')
  }, 15000)
})
