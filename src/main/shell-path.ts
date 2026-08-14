import { execFile } from 'child_process'

// macOS GUI apps launched from Finder, the Dock, or `open` inherit launchd's
// minimal PATH — /usr/bin:/bin:/usr/sbin:/sbin — not the login shell's. Git
// itself still resolves (the Xcode command line tools ship /usr/bin/git), so
// the app looks healthy right up until git shells out to something Homebrew
// installed:
//
//   commit.gpgsign=true + gpg.program=gpg
//     → error: cannot run gpg: No such file or directory
//     → fatal: failed to write commit object
//
// Same hole swallows git-lfs, delta, ssh signing helpers, and hook
// interpreters (husky's node, pre-commit's python). Ask the login shell for
// its PATH once at startup and merge it into process.env so every later
// spawn inherits it.

// Everything launchd hands a GUI app. If PATH contains nothing outside this
// set, we were not started from a shell and the real PATH is missing.
const LAUNCHD_BASELINE = new Set([
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  '/usr/local/bin',
])

// Interactive shells print MOTDs, version notices, and prompt escapes. Fence
// the value so we can find it in the noise.
const DELIM = '__GIT_GUD_PATH__'

export function needsShellPath(currentPath: string | undefined): boolean {
  const entries = (currentPath ?? '').split(':').map((e) => e.trim()).filter(Boolean)
  if (entries.length === 0) return true
  return entries.every((e) => LAUNCHD_BASELINE.has(e))
}

export function parseShellPath(stdout: string): string | null {
  const parts = stdout.split(DELIM)
  if (parts.length < 3) return null
  const value = parts[1].trim()
  return value || null
}

// Shell PATH wins on order — a user who puts /opt/homebrew/bin ahead of
// /usr/bin means it. Baseline entries the shell dropped are appended rather
// than discarded so core tools stay reachable either way.
export function mergePath(resolved: string, current: string | undefined): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of [...resolved.split(':'), ...(current ?? '').split(':')]) {
    const e = entry.trim()
    if (!e || seen.has(e)) continue
    seen.add(e)
    out.push(e)
  }
  return out.join(':')
}

const SHELL_TIMEOUT_MS = 3000

function runLoginShell(shell: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(guard)
      resolve(value)
    }

    // -i so ~/.zshrc (where PATH edits usually live) is sourced, -l for
    // ~/.zprofile.
    //
    // killSignal SIGKILL is load-bearing: an interactive shell ignores
    // SIGTERM by design, so execFile's own timeout can fire, be shrugged
    // off, and leave the callback pending forever — hanging startup.
    const script = `printf %s ${DELIM}; printf %s "$PATH"; printf %s ${DELIM}`
    const child = execFile(
      shell,
      ['-ilc', script],
      { timeout: SHELL_TIMEOUT_MS, killSignal: 'SIGKILL', encoding: 'utf8' },
      (err, stdout) => {
        if (err && !stdout) return finish(null)
        finish(parseShellPath(stdout ?? ''))
      },
    )

    // Second line of defence: even SIGKILL leaves the callback waiting if an
    // rc file spawned a daemon holding stdout open. Never block startup on it.
    const guard = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already dead */ }
      finish(null)
    }, SHELL_TIMEOUT_MS + 500)
  })
}

// Best effort by design: a broken shell config must not stop the app from
// starting. Worst case PATH stays as it was and the user hits the same
// missing-binary error they would have hit anyway.
export async function applyShellPath(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  if (!needsShellPath(env.PATH)) return false

  const shell = env.SHELL || '/bin/zsh'
  try {
    const resolved = await runLoginShell(shell)
    if (!resolved) return false
    env.PATH = mergePath(resolved, env.PATH)
    return true
  } catch {
    return false
  }
}
