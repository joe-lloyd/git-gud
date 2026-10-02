// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as https from 'https'
import type { AddressInfo } from 'net'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { generateSelfSigned } from '../../src/main/peer-tls'
import { ForgejoProvider } from '../../src/main/forge/forgejo'
import { ForgeHost, needsReview } from '../../src/main/forge/forge-host'
import {
  parseBotComment, parseFileDiff, parsePullDetail, parsePullFileList, parsePullList, parseForgeInfo, parsePullCommits,
  rollupChecks, splitUnifiedDiff, truncatePatch, unquotePath, type StatusCheck,
} from '../../src/main/peer-protocol'
import { startDaemon, loadForgeConfigs, type RunningDaemon } from '../../src/headless/daemon'
import { DEFAULT_CONFIG } from '../../src/headless/config'
import { createLogger } from '../../src/headless/log'
import { controlRequest } from '../../src/headless/control'
import { PeerConnection } from '../../src/main/peer-client'

// ── Fixtures ────────────────────────────────────────────────────────────

const DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,4 @@',
  ' import x from "x"',
  '-const a = 1',
  '+const a = 2',
  '+const b = 3',
  ' export default a',
  'diff --git a/old name.md b/new name.md',
  'similarity index 90%',
  'rename from old name.md',
  'rename to new name.md',
  'index 3333333..4444444 100644',
  '--- a/old name.md',
  '+++ b/new name.md',
  '@@ -1 +1 @@',
  '--- a heading rule',
  '+--- a better rule',
  'diff --git a/logo.png b/logo.png',
  'new file mode 100644',
  'index 0000000..5555555',
  'Binary files /dev/null and b/logo.png differ',
  'diff --git a/gone.txt b/gone.txt',
  'deleted file mode 100644',
  'index 6666666..0000000',
  '--- a/gone.txt',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-bye',
  '-now',
  'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"',
  'new file mode 100644',
  'index 0000000..7777777',
  '--- /dev/null',
  '+++ "b/caf\\303\\251.txt"',
  '@@ -0,0 +1 @@',
  '+bonjour',
  '\\ No newline at end of file',
  '',
].join('\n')

const JEV_BODY = [
  '<!-- jev-base-review -->',
  '## JEV first pass',
  '',
  'JEV leans changes required 61% · merge 39%',
  'This status is advisory and never blocks a merge; the belt contexts do.',
  '',
  '### Review focus',
  '',
  '- Inspect `src/app.ts` first. JEV selected it at 72%.',
  '- correctness risk: moderate 40%; non-ideal probability 52%',
  '',
  '| Check | JEV choice | Choice probability |',
  '|---|---|---:|',
].join('\n')

describe('forge protocol helpers', () => {
  it('splits a git diff per file: modified, renamed (spaces), binary, deleted, quoted unicode', () => {
    const s = splitUnifiedDiff(DIFF)
    expect(s.map((x) => [x.path, x.status, x.binary, x.add, x.del])).toEqual([
      ['src/app.ts', 'modified', false, 2, 1],
      ['new name.md', 'renamed', false, 1, 1],
      ['logo.png', 'added', true, 0, 0],
      ['gone.txt', 'deleted', false, 0, 2],
      ['café.txt', 'added', false, 1, 0],
    ])
    expect(s[1].previous).toBe('old name.md')
    // a deleted line that starts with "--" is content, not a header
    expect(s[1].patch).toContain('--- a heading rule')
    expect(s[0].patch.startsWith('diff --git a/src/app.ts')).toBe(true)
  })

  it('unquotes git C-style paths and leaves plain ones alone', () => {
    expect(unquotePath('"a/caf\\303\\251.txt"')).toBe('a/café.txt')
    expect(unquotePath('"tab\\there"')).toBe('tab\there')
    expect(unquotePath('plain/path.ts')).toBe('plain/path.ts')
  })

  it('rolls up belt checks without bot contexts', () => {
    const st = (context: string, state: StatusCheck['state']): StatusCheck => ({ context, state, description: '' })
    const bots = new Set(['jev/base-review'])
    expect(rollupChecks([st('build', 'success'), st('jev/base-review', 'warning')], bots)).toBe('success')
    expect(rollupChecks([st('build', 'success'), st('test', 'pending')], bots)).toBe('pending')
    expect(rollupChecks([st('build', 'failure'), st('test', 'pending')], bots)).toBe('failure')
    expect(rollupChecks([st('jev/base-review', 'success')], bots)).toBe('none')
    expect(rollupChecks([st('lint', 'skipped'), st('build', 'success')], bots)).toBe('success')
  })

  it('lifts headline and review focus out of the JEV comment', () => {
    expect(parseBotComment(JEV_BODY)).toEqual({
      headline: 'JEV leans changes required 61% · merge 39%',
      focus: ['Inspect `src/app.ts` first. JEV selected it at 72%.', 'correctness risk: moderate 40%; non-ideal probability 52%'],
    })
    expect(parseBotComment('just text')).toEqual({ headline: undefined, focus: [] })
  })

  it('truncates at a line boundary', () => {
    const r = truncatePatch('aaaa\nbbbb\ncccc', 11)
    expect(r).toEqual({ patch: 'aaaa\nbbbb', truncated: true })
    expect(truncatePatch('short', 100)).toEqual({ patch: 'short', truncated: false })
  })

  it('needsReview: drafts never, requested always, otherwise "not reviewed at this head"', () => {
    const pull = { state: 'open' as const, draft: false, headSha: 'bbb', requestedReviewers: [] as string[] }
    const rev = (commitId: string, state = 'APPROVED') => ({ user: 'joe', state, submittedAt: '', commitId, body: '', stale: false })
    expect(needsReview(pull, [], 'joe')).toBe(true)
    expect(needsReview(pull, [rev('bbb')], 'joe')).toBe(false)
    expect(needsReview(pull, [rev('aaa')], 'joe')).toBe(true) // pushed since
    expect(needsReview({ ...pull, draft: true }, [], 'joe')).toBe(false)
    expect(needsReview({ ...pull, requestedReviewers: ['joe'] }, [rev('bbb')], 'joe')).toBe(true)
    expect(needsReview(pull, [{ ...rev('bbb'), user: 'jev-reviewer' }], 'joe')).toBe(true)
  })

  it('guards reject the wrong shape', () => {
    expect(parsePullList({ pulls: [{ forge: 'x' }], errors: [] })).toBeNull()
    expect(parsePullList({ pulls: [], errors: [] })).toEqual({ pulls: [], errors: [] })
    expect(parseFileDiff({ path: 'a', headSha: 'b', patch: '', truncated: 'no', binary: false, lines: 0 })).toBeNull()
    expect(parsePullCommits('nope')).toBeNull()
  })
})

// ── A fake Forgejo over HTTPS with its own CA ──────────────────────────

type FakeState = { head: string; reviews: Array<{ user: { login: string }; state: string; commit_id: string; submitted_at: string; body: string }>; requests: Array<{ path: string; auth: string }> }

function startFakeForgejo(tls: { keyPem: string; certPem: string }, state: FakeState): Promise<https.Server> {
  const srv = https.createServer({ key: tls.keyPem, cert: tls.certPem }, (req, res) => {
    const url = new URL(req.url ?? '/', 'https://x')
    const p = url.pathname.replace(/^\/api\/v1/, '')
    state.requests.push({ path: p, auth: String(req.headers.authorization ?? '') })
    const json = (body: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.headers.authorization !== 'token s3cret-token') return json({ message: 'token is required' }, 401)
    const pull = (n: number) => ({
      number: n, state: 'open', title: n === 1 ? 'feat: forge layer' : 'wip: draft thing', body: 'Adds **forge**.', user: { login: 'joe' },
      draft: n === 2, created_at: '2026-10-01T10:00:00Z', updated_at: n === 1 ? `2026-10-02T10:00:00Z-${state.head}-${state.reviews.length}` : '2026-10-01T11:00:00Z',
      head: { sha: n === 1 ? state.head : 'dddd000', ref: 'feat/forge' }, base: { ref: 'main' },
      additions: 4, deletions: 4, changed_files: 5, comments: 1, review_comments: 0, mergeable: true,
      html_url: `https://git.example/joe/app/pulls/${n}`, requested_reviewers: [],
    })
    if (p === '/user') return json({ login: 'joe' })
    if (p === '/repos/issues/search') {
      const page = Number(url.searchParams.get('page') ?? 1)
      if (page > 1) return json([])
      return json([
        { number: 1, repository: { full_name: 'joe/app' }, updated_at: `2026-10-02T10:00:00Z-${state.head}-${state.reviews.length}` },
        { number: 2, repository: { full_name: 'joe/app' }, updated_at: '2026-10-01T11:00:00Z' },
      ])
    }
    const m = /^\/repos\/joe\/app\/(.+)$/.exec(p)
    if (!m) return json({ message: 'nope' }, 404)
    const rest = m[1]
    if (rest === 'pulls/1' || rest === 'pulls/2') return json(pull(Number(rest.slice(6))))
    if (/^commits\/[0-9a-f]+\/status$/.test(rest)) {
      return json({ state: 'warning', statuses: [
        { context: 'belt/build', status: 'success', description: 'ok', target_url: 'https://ci/1' },
        { context: 'jev/base-review', status: 'warning', description: 'JEV leans changes required 61%', target_url: 'https://git.example/joe/app/pulls/1' },
      ] })
    }
    if (rest === 'pulls/1/reviews' || rest === 'pulls/2/reviews') return json(rest.startsWith('pulls/1') ? state.reviews : [])
    if (rest === 'issues/1/comments') return json([{ user: { login: 'jev-reviewer' }, body: JEV_BODY, html_url: 'https://git.example/c/1' }])
    if (rest === 'pulls/1.diff') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(DIFF) }
    if (rest === 'pulls/1/commits') return json([{ sha: state.head, commit: { message: 'feat: forge layer\n\nbody', author: { name: 'Joe', date: '2026-10-02T09:00:00Z' } }, author: { login: 'joe' } }])
    return json({ message: 'nope' }, 404)
  })
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)))
}

describe('ForgejoProvider + ForgeHost against a fake Forgejo', () => {
  const tls = generateSelfSigned('localhost')
  const state: FakeState = { head: 'aaaa111', reviews: [], requests: [] }
  let srv: https.Server
  let url: string
  let host: ForgeHost

  beforeAll(async () => {
    srv = await startFakeForgejo(tls, state)
    url = `https://localhost:${(srv.address() as AddressInfo).port}`
    host = new ForgeHost([{ provider: new ForgejoProvider({ id: 'home', url, token: 's3cret-token', ca: tls.certPem }) }])
  })
  afterAll(() => srv.close())

  it('without the CA, TLS fails with an actionable message; with it, requests authenticate', async () => {
    const noCa = new ForgejoProvider({ id: 'x', url, token: 's3cret-token' })
    await expect(noCa.whoami()).rejects.toThrow(/TLS: .*caFile/)
    const p = new ForgejoProvider({ id: 'x', url, token: 's3cret-token', ca: tls.certPem })
    expect(await p.whoami()).toBe('joe')
    expect(state.requests.at(-1)?.auth).toBe('token s3cret-token')
  })

  it('a bad token is reported without leaking it', async () => {
    const bad = new ForgeHost([{ provider: new ForgejoProvider({ id: 'home', url, token: 'wrong-token-xyz', ca: tls.certPem }) }])
    const r = await bad.handle('__forgeListPulls', [{}])
    expect(r.ok).toBe(true)
    const list = (r as { result: { pulls: unknown[]; errors: Array<{ error: string }> } }).result
    expect(list.pulls).toEqual([])
    expect(list.errors[0].error).toMatch(/rejected the token \(401\)/)
    expect(JSON.stringify(r)).not.toContain('wrong-token-xyz')
  })

  it('lists open PRs with belt rollup, JEV state and needsReview (drafts excluded)', async () => {
    const r = await host.handle('__forgeListPulls', [{}])
    expect(r.ok).toBe(true)
    const list = parsePullList((r as { result: unknown }).result)!
    expect(list).not.toBeNull()
    expect(list.errors).toEqual([])
    const [one, two] = list.pulls
    expect(one).toMatchObject({ repo: 'joe/app', number: 1, checks: 'success', needsReview: true, headSha: 'aaaa111', draft: false })
    expect(one.bots).toEqual([{ name: 'JEV', context: 'jev/base-review', state: 'warning', description: 'JEV leans changes required 61%', url: 'https://git.example/joe/app/pulls/1' }])
    expect(two).toMatchObject({ number: 2, draft: true, needsReview: false })
  })

  it('PR detail pins the JEV headline + focus and carries statuses', async () => {
    const r = await host.handle('__forgeGetPull', [{ forge: 'home', repo: 'joe/app', number: 1 }])
    const d = parsePullDetail((r as { result: unknown }).result)!
    expect(d).not.toBeNull()
    expect(d.me).toBe('joe')
    expect(d.bots[0]).toMatchObject({ name: 'JEV', state: 'warning', headline: 'JEV leans changes required 61% · merge 39%' })
    expect(d.bots[0].focus).toHaveLength(2)
    expect(d.statuses.map((s) => s.context)).toEqual(['belt/build', 'jev/base-review'])
  })

  it('files come from one diff fetch per head; per-file diffs are pinned to that head', async () => {
    const before = state.requests.filter((q) => q.path.endsWith('.diff')).length
    const files = parsePullFileList((await host.handle('__forgeListFiles', [{ forge: 'home', repo: 'joe/app', number: 1 }]) as { result: unknown }).result)!
    expect(files.headSha).toBe('aaaa111')
    expect(files.files.map((f) => f.path)).toEqual(['src/app.ts', 'new name.md', 'logo.png', 'gone.txt', 'café.txt'])
    expect(files.files[1]).toMatchObject({ previous: 'old name.md', status: 'renamed' })
    const fd = parseFileDiff((await host.handle('__forgeFileDiff', [{ forge: 'home', repo: 'joe/app', number: 1, headSha: 'aaaa111', path: 'src/app.ts' }]) as { result: unknown }).result)!
    expect(fd.patch).toContain('+const b = 3')
    expect(fd.truncated).toBe(false)
    const bin = parseFileDiff((await host.handle('__forgeFileDiff', [{ forge: 'home', repo: 'joe/app', number: 1, headSha: 'aaaa111', path: 'logo.png' }]) as { result: unknown }).result)!
    expect(bin).toMatchObject({ binary: true, patch: '' })
    expect(state.requests.filter((q) => q.path.endsWith('.diff')).length).toBe(before + 1)
  })

  it('a push moves the head: old head → stale, review on old head → needs review again, unchanged files keep their patchHash', async () => {
    const old = parsePullFileList((await host.handle('__forgeListFiles', [{ forge: 'home', repo: 'joe/app', number: 1 }]) as { result: unknown }).result)!
    state.reviews = [{ user: { login: 'joe' }, state: 'APPROVED', commit_id: 'aaaa111', submitted_at: '2026-10-02T10:30:00Z', body: '' }]
    let list = parsePullList((await host.handle('__forgeListPulls', [{}]) as { result: unknown }).result)!
    expect(list.pulls[0].needsReview).toBe(false)

    state.head = 'bbbb222'
    await new Promise((r) => setTimeout(r, 0))
    const stale = await host.handle('__forgeFileDiff', [{ forge: 'home', repo: 'joe/app', number: 1, headSha: 'aaaa111', path: 'src/app.ts' }])
    // the head cache may still say aaaa111 for a few seconds; a fresh files call never does
    const files = parsePullFileList((await host.handle('__forgeListFiles', [{ forge: 'home', repo: 'joe/app', number: 1 }]) as { result: unknown }).result)!
    expect(files.headSha).toBe('bbbb222')
    expect(files.files.map((f) => f.patchHash)).toEqual(old.files.map((f) => f.patchHash)) // same fixture diff → same hashes
    const stale2 = await host.handle('__forgeFileDiff', [{ forge: 'home', repo: 'joe/app', number: 1, headSha: 'aaaa111', path: 'src/app.ts' }])
    expect(stale2).toMatchObject({ ok: false, code: 'stale' })
    expect([true, false]).toContain(stale.ok)

    list = parsePullList((await host.handle('__forgeListPulls', [{}]) as { result: unknown }).result)!
    expect(list.pulls[0]).toMatchObject({ headSha: 'bbbb222', needsReview: true })
  })

  it('commits, info and argument validation', async () => {
    const c = parsePullCommits((await host.handle('__forgeListCommits', [{ forge: 'home', repo: 'joe/app', number: 1 }]) as { result: unknown }).result)!
    expect(c[0]).toMatchObject({ subject: 'feat: forge layer', author: 'joe' })
    const info = parseForgeInfo((await host.handle('__forgeInfo', []) as { result: unknown }).result)!
    expect(info.forges).toEqual([{ id: 'home', kind: 'forgejo', url, user: 'joe' }])
    expect(await host.handle('__forgeGetPull', [{ forge: 'home', repo: '../etc', number: 1 }])).toMatchObject({ ok: false, code: 'failed' })
    expect(await host.handle('__forgeGetPull', [{ forge: 'home', repo: '../user', number: 1 }])).toMatchObject({ ok: false, code: 'failed' })
    expect(await host.handle('__forgeGetPull', [{ forge: 'home', repo: 'joe/..', number: 1 }])).toMatchObject({ ok: false, code: 'failed' })
    expect(await host.handle('__forgeGetPull', [{ forge: 'home', repo: 'joe/a%2F..', number: 1 }])).toMatchObject({ ok: false, code: 'failed' })
    expect(await host.handle('__forgeGetPull', [{ forge: 'nope', repo: 'joe/app', number: 1 }])).toMatchObject({ ok: false, code: 'not-found' })
    expect(await host.handle('__forgeFileDiff', [{ forge: 'home', repo: 'joe/app', number: 1, headSha: 'bbbb222', path: 'not/there' }])).toMatchObject({ ok: false })
  })
})

// ── Daemon end to end: config → files → peer RPC ───────────────────────

describe('gitgud-headless with a forge', () => {
  const tls = generateSelfSigned('localhost')
  const state: FakeState = { head: 'aaaa111', reviews: [], requests: [] }
  let srv: https.Server, d: RunningDaemon, home: string
  const self = { peerId: 'f0f0f0f0f0f0f0f0', name: 'Phone' }

  beforeAll(async () => {
    srv = await startFakeForgejo(tls, state)
    home = mkdtempSync(join(tmpdir(), 'gg-forge-'))
    writeFileSync(join(home, 'token'), 's3cret-token\n'); chmodSync(join(home, 'token'), 0o600)
    writeFileSync(join(home, 'ca.pem'), tls.certPem)
    const cfg = {
      ...DEFAULT_CONFIG, name: 'old-mac', port: 47970, bind: '127.0.0.1', pairingWindowMinutes: 1,
      forges: [{ id: 'home', kind: 'forgejo' as const, url: `https://localhost:${(srv.address() as AddressInfo).port}`, tokenFile: join(home, 'token'), caFile: join(home, 'ca.pem'), owners: [] }],
    }
    const paths = { configDir: home, dataDir: join(home, 'data'), stateDir: join(home, 'state'), runtimeDir: join(home, 'run') }
    d = await startDaemon({ paths, version: '9.9.9', log: createLogger({ sink: () => {} }), config: cfg })
  })
  afterAll(async () => { await d.stop(); srv.close(); rmSync(home, { recursive: true, force: true }) })

  it('advertises the forge feature and serves __forge* to a read-only paired device; never the token', async () => {
    const { info, certPem } = await PeerConnection.probe('127.0.0.1', d.port)
    expect(info.features).toEqual(['forge'])
    const { code } = (await controlRequest(d.socketPath, { cmd: 'pair' })) as { code: string }
    const paired = await PeerConnection.pair('127.0.0.1', d.port, code, self, certPem)
    expect(paired.readOnly).toBe(true)
    const conn = new PeerConnection({ peerId: d.peerId, name: 'old-mac', host: '127.0.0.1', port: d.port, token: paired.token, certPem }, self)
    const list = parsePullList(await conn.rpc('', '__forgeListPulls', [{}]))!
    expect(list.pulls.map((p) => p.number)).toEqual([1, 2])
    const detail = await conn.rpc('', '__forgeGetPull', [{ forge: 'home', repo: 'joe/app', number: 1 }])
    expect(JSON.stringify(detail)).not.toContain('s3cret-token')
    await expect(conn.rpc('', '__forgeNope', [])).rejects.toMatchObject({ code: 'not-found' })
    const check = (await controlRequest(d.socketPath, { cmd: 'forge-check' })) as Array<{ user: string; openPulls: number }>
    expect(check[0]).toMatchObject({ user: 'joe', openPulls: 2 })
    conn.disconnect()
  })

  it('refuses a token file others can read', () => {
    const warn: string[] = []
    chmodSync(join(home, 'token'), 0o644)
    expect(loadForgeConfigs([{ id: 'home', kind: 'forgejo', url: 'https://x', tokenFile: join(home, 'token'), owners: [] }], (m) => warn.push(m))).toEqual([])
    expect(warn[0]).toMatch(/chmod 600/)
    chmodSync(join(home, 'token'), 0o600)
  })
})

describe('headless config: forges', () => {
  it('parses forges from JSONC (URL with // inside a string survives comment stripping) and validates them', async () => {
    const { parseConfig } = await import('../../src/headless/config')
    const cfg = parseConfig(`{
      // pull requests
      "forges": [{ "id": "home", "kind": "forgejo", "url": "https://git.home.arpa/", "tokenFile": "~/t", "caFile": "~/ca.pem", "owners": ["joe-lloyd"] }],
    }`)
    expect(cfg.forges).toEqual([{ id: 'home', kind: 'forgejo', url: 'https://git.home.arpa', tokenFile: '~/t', caFile: '~/ca.pem', owners: ['joe-lloyd'] }])
    expect(() => parseConfig('{ "forges": [{ "url": "http://plain", "tokenFile": "t" }] }')).toThrow(/https/)
    expect(() => parseConfig('{ "forges": [{ "id": "a", "url": "https://x", "tokenFile": "t" }, { "id": "a", "url": "https://y", "tokenFile": "t" }] }')).toThrow(/duplicate/)
    expect(parseConfig('{}').forges).toEqual([])
  })
})
