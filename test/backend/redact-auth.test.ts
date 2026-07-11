import { describe, it, expect } from 'vitest'
import { redactAuthArgs, scrubSecrets } from '../../src/main/git-service'

// Auth is injected into network git commands as
//   -c http.<host>.extraheader=AUTHORIZATION: basic <base64>
// Those argv strings feed the Git Activity log rendered in the UI, so the
// credential must never survive redaction — a screenshot or screen-share of
// the activity panel would otherwise leak a live token.

const GH_SECRET = 'AUTHORIZATION: basic eC1hY2Nlc3M6Z2hvX2FiYzEyMw=='
const GH_ARG = `http.https://github.com/.extraheader=${GH_SECRET}`

describe('redactAuthArgs', () => {
  it('strips the credential from a GitHub extraheader config', () => {
    const { args, secrets } = redactAuthArgs(['-c', GH_ARG, 'push', 'origin', 'refs/tags/v1'])
    expect(args.join(' ')).not.toContain('eC1hY2Nlc3M')
    expect(args[1]).toMatch(/^http\.https:\/\/github\.com\/\.extraheader=AUTHORIZATION: /)
    expect(secrets).toEqual([GH_SECRET])
  })

  it('handles GitLab (custom host) and Bitbucket shapes', () => {
    const gl = 'http.https://gitlab.example.com/.extraheader=AUTHORIZATION: basic b2F1dGgyOnRva2Vu'
    const bb = 'http.https://bitbucket.org/.extraheader=AUTHORIZATION: basic dXNlcjphcHBwdw=='
    const { args, secrets } = redactAuthArgs(['-c', gl, '-c', bb, 'fetch', '--all'])
    expect(args.join(' ')).not.toContain('b2F1dGgy')
    expect(args.join(' ')).not.toContain('dXNlcjphcHBwdw')
    expect(secrets).toHaveLength(2)
  })

  it('leaves ordinary args and non-auth -c configs untouched', () => {
    const input = ['-c', 'core.autocrlf=false', 'commit', '-m', 'extraheader= in a message']
    const { args, secrets } = redactAuthArgs(input)
    expect(args).toEqual(input)
    expect(secrets).toEqual([])
  })
})

describe('scrubSecrets', () => {
  it('removes the full header value and the bare credential from output', () => {
    const secrets = [GH_SECRET]
    const out = `fatal: unable to update url\nheader was ${GH_SECRET}\ncred eC1hY2Nlc3M6Z2hvX2FiYzEyMw== end`
    const scrubbed = scrubSecrets(out, secrets)
    expect(scrubbed).not.toContain('eC1hY2Nlc3M')
    expect(scrubbed).toContain('fatal: unable to update url')
  })

  it('is a no-op when there are no secrets', () => {
    expect(scrubSecrets('normal output', [])).toBe('normal output')
  })
})
