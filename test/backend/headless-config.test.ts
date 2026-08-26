// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execSync } from 'child_process'
import { stripJsonComments, parseConfig, renderDefaultConfig, resolvePaths, resolveBindAddress, effectiveReadOnly, DEFAULT_CONFIG } from '../../src/headless/config'
import { scanForRepos, ConfigRepoAllowList } from '../../src/headless/repos'

describe('headless config', () => {
  it('strips // and /* */ comments but not inside strings; tolerates trailing commas', () => {
    const src = `{ // c\n "a": "http://x", /* b */ "b": [1,2,], "c": "a\\"//b", }`
    expect(JSON.parse(stripJsonComments(src))).toEqual({ a: 'http://x', b: [1, 2], c: 'a"//b' })
  })
  it('the generated default config round-trips and is read-only + deny-listed by default', () => {
    const cfg = parseConfig(renderDefaultConfig())
    expect(cfg.readOnly).toBe(true)
    expect(cfg.bind).toBe('127.0.0.1')
    expect(cfg.denyMethods).toEqual(['setConfig', 'writeFileContent'])
    expect(cfg.discovery).toBe(false)
    expect(cfg.pairingWindowMinutes).toBe(DEFAULT_CONFIG.pairingWindowMinutes)
  })
  it('validates port, bind and absolute repo paths; clamps scan depth', () => {
    expect(() => parseConfig('{"port": 70000}')).toThrow(/port/)
    expect(() => parseConfig('{"repos": ["relative/x"]}')).toThrow(/absolute/)
    expect(parseConfig('{"scanRoots": ["/srv", {"path": "/x", "depth": 9}]}').scanRoots).toEqual([{ path: '/srv', depth: 1 }, { path: '/x', depth: 4 }])
  })
  it('resolves XDG paths and the GITGUD_HEADLESS_HOME override', () => {
    const p = resolvePaths({ HOME: '/h', XDG_CONFIG_HOME: '/cfg', XDG_RUNTIME_DIR: '/run/user/1' })
    expect(p.configDir).toBe('/cfg/gitgud-headless')
    expect(p.dataDir).toBe('/h/.local/share/gitgud-headless')
    expect(p.runtimeDir).toBe('/run/user/1/gitgud-headless')
    expect(resolvePaths({ GITGUD_HEADLESS_HOME: '/one' }).dataDir).toBe('/one/data')
  })
  it('forces read-only on a public bind unless explicitly allowed', () => {
    expect(effectiveReadOnly({ readOnly: false, allowWritesOnPublicBind: false }, '203.0.113.4')).toEqual({ readOnly: true, forced: true })
    expect(effectiveReadOnly({ readOnly: false, allowWritesOnPublicBind: false }, '0.0.0.0')).toEqual({ readOnly: true, forced: true })
    expect(effectiveReadOnly({ readOnly: false, allowWritesOnPublicBind: false }, '100.64.0.5')).toEqual({ readOnly: false, forced: false })
    expect(effectiveReadOnly({ readOnly: false, allowWritesOnPublicBind: false }, '127.0.0.1')).toEqual({ readOnly: false, forced: false })
    expect(effectiveReadOnly({ readOnly: false, allowWritesOnPublicBind: true }, '203.0.113.4')).toEqual({ readOnly: false, forced: false })
    expect(effectiveReadOnly({ readOnly: true, allowWritesOnPublicBind: true }, '127.0.0.1')).toEqual({ readOnly: true, forced: false })
    expect(() => parseConfig('{"allowSourceCidrs": ["nope!"]}')).toThrow(/CIDR/)
    expect(parseConfig(renderDefaultConfig()).allowSourceCidrs).toEqual([])
  })

  it('resolves interface names to IPv4 addresses and passes IPs through', () => {
    const ifs = () => ({ tailscale0: [{ address: '100.64.0.5', family: 'IPv4', internal: false } as any, { address: 'fd7a::1', family: 'IPv6', internal: false } as any] })
    expect(resolveBindAddress('tailscale0', ifs)).toBe('100.64.0.5')
    expect(resolveBindAddress('0.0.0.0', ifs)).toBe('0.0.0.0')
    expect(() => resolveBindAddress('eth9', ifs)).toThrow(/no interface/)
  })
})

describe('headless repo scan', () => {
  it('finds repos to the configured depth and never descends into a repo or node_modules', () => {
    const root = mkdtempSync(join(tmpdir(), 'scan-'))
    const mk = (rel: string, git = true) => { const d = join(root, rel); mkdirSync(d, { recursive: true }); if (git) execSync('git init -q', { cwd: d, env: { ...process.env, GIT_DIR: undefined } }) }
    mk('a'); mk('deep/b'); mk('deep/deeper/c'); mk('node_modules/pkg'); mk('a/nested')
    const found = scanForRepos({ path: root, depth: 2 }).map((p) => p.slice(root.length + 1)).sort()
    expect(found).toEqual(['a', 'deep/b'])
    const allow = new ConfigRepoAllowList(() => [join(root, 'deep/deeper/c')], () => [{ path: root, depth: 1 }])
    const list = allow.refresh()
    expect([...list.values()]).toContain(true)  // explicit repo flagged open
    expect(list.size).toBe(2)                    // c (explicit) + a (scan depth 1)
    rmSync(root, { recursive: true, force: true })
  })
})
