import { describe, it, expect } from 'vitest'
import { parseRawLog, parseChangeIdField } from '../../src/main/git-service'

// The log format is: COMMIT_SEP\n sha ␟ parents ␟ author ␟ email ␟ date ␟ refs
// ␟ change-id ␟ subject — the Change-Id field was added for Gerrit mode and
// must stay invisible for commits without trailers.

const FS = '\x1f'
const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const CHANGE_ID = 'I0123456789abcdef0123456789abcdef01234567'

const block = (sha: string, changeIdField: string, subject: string, parents = '') =>
  `COMMIT_SEP\n${sha}${FS}${parents}${FS}Ann Author${FS}ann@example.com${FS}2026-08-01T10:00:00+02:00${FS}HEAD -> main${FS}${changeIdField}${FS}${subject}\n`

describe('parseRawLog Change-Id field', () => {
  it('extracts the Change-Id when present', () => {
    const commits = parseRawLog(block(SHA_A, CHANGE_ID, 'feat: add thing'))
    expect(commits).toHaveLength(1)
    expect(commits[0].changeId).toBe(CHANGE_ID)
    expect(commits[0].message).toBe('feat: add thing')
    expect(commits[0].refs).toEqual(['HEAD', 'main'])
  })

  it('leaves commits without trailers unchanged (no changeId key)', () => {
    const commits = parseRawLog(block(SHA_B, '', 'plain commit'))
    expect(commits).toHaveLength(1)
    expect(commits[0].changeId).toBeUndefined()
    expect('changeId' in commits[0]).toBe(false)
    expect(commits[0].message).toBe('plain commit')
  })

  it('parses multiple commits with mixed trailer presence', () => {
    const raw = block(SHA_A, CHANGE_ID, 'gerrit commit', SHA_B) + block(SHA_B, '', 'plain commit')
    const commits = parseRawLog(raw)
    expect(commits.map((c) => c.changeId)).toEqual([CHANGE_ID, undefined])
    expect(commits[0].parents).toEqual([SHA_B])
  })
})

describe('parseChangeIdField', () => {
  it('takes the last of several Change-Ids (Gerrit honors the last trailer)', () => {
    const first = 'I' + '1'.repeat(40)
    expect(parseChangeIdField(`${first} ${CHANGE_ID}`)).toBe(CHANGE_ID)
  })

  it('rejects the literal format specifier from pre-2.22 gits', () => {
    expect(parseChangeIdField('%(trailers:key=Change-Id,valueonly,separator=%x20)')).toBeUndefined()
  })

  it('rejects values not shaped like a Change-Id', () => {
    expect(parseChangeIdField('not-a-change-id')).toBeUndefined()
    expect(parseChangeIdField('')).toBeUndefined()
    expect(parseChangeIdField('   ')).toBeUndefined()
  })
})
