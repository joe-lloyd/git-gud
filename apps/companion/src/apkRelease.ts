// Which companion APK to update to. Pure, so it is testable without React
// Native: parse the GitHub releases response at the boundary, then pick the
// newest release that carries an APK and is newer than what is running.

export interface ApkRelease {
  version: string // "1.21.0" or "1.22.0-dev.0", from the tag
  tag: string
  url: string
  name: string
  size: number
}

interface GitHubRelease {
  tag: string
  draft: boolean
  prerelease: boolean
  assets: { name: string; url: string; size: number }[]
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null

/** Keep only well-formed entries of GET /repos/:owner/:repo/releases. */
export function parseReleases(json: unknown): GitHubRelease[] {
  if (!Array.isArray(json)) throw new Error('Unexpected GitHub response')
  return json.flatMap((r): GitHubRelease[] => {
    if (!isObj(r) || typeof r.tag_name !== 'string' || !Array.isArray(r.assets)) return []
    const assets = r.assets.flatMap((a) =>
      isObj(a) && typeof a.name === 'string' && typeof a.browser_download_url === 'string'
        ? [{ name: a.name, url: a.browser_download_url, size: typeof a.size === 'number' ? a.size : 0 }]
        : [])
    return [{ tag: r.tag_name, draft: r.draft === true, prerelease: r.prerelease === true, assets }]
  })
}

/** Semver order, prereleases below their release: 1.2.0-dev.1 < 1.2.0 < 1.2.1. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core, ...pre] = v.replace(/^v/, '').split('-')
    return { core: core.split('.').map((n) => Number(n) || 0), pre: pre.join('-') }
  }
  const x = split(a), y = split(b)
  for (let i = 0; i < 3; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0)
    if (d) return Math.sign(d)
  }
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  const xs = x.pre.split('.'), ys = y.pre.split('.')
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    if (xs[i] === undefined) return -1
    if (ys[i] === undefined) return 1
    const nx = Number(xs[i]), ny = Number(ys[i])
    const d = Number.isInteger(nx) && Number.isInteger(ny) ? nx - ny : xs[i].localeCompare(ys[i])
    if (d) return Math.sign(d)
  }
  return 0
}

/**
 * The newest APK newer than `current`, or null when up to date. A stable
 * build only looks at stable releases; a dev build (version with "-") also
 * takes newer dev releases, like the desktop's Dev update channel.
 */
export function newerApk(releases: GitHubRelease[], current: string): ApkRelease | null {
  const dev = current.includes('-')
  let best: ApkRelease | null = null
  for (const r of releases) {
    if (r.draft || (r.prerelease && !dev)) continue
    const version = r.tag.replace(/^v/, '')
    const apk = r.assets.find((a) => a.name === `Git-Gud-Companion-${version}.apk`)
    if (!apk || compareVersions(version, current) <= 0) continue
    if (!best || compareVersions(version, best.version) > 0) best = { version, tag: r.tag, url: apk.url, name: apk.name, size: apk.size }
  }
  return best
}
