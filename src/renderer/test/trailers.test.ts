import { describe, it, expect } from 'vitest'
import { splitTrailers, findCommitByChangeId } from '../lib/trailers'

const CHANGE_ID = 'I0123456789abcdef0123456789abcdef01234567'

describe('splitTrailers', () => {
  it('returns the body unchanged when there are no trailers', () => {
    const body = 'Just a normal body.\n\nWith two paragraphs.'
    expect(splitTrailers(body)).toEqual({ text: body, trailers: [] })
  })

  it('splits a trailing trailer paragraph from the prose', () => {
    const body = `Explains the fix in detail.\n\nChange-Id: ${CHANGE_ID}\nSigned-off-by: Ann Author <ann@example.com>`
    const { text, trailers } = splitTrailers(body)
    expect(text).toBe('Explains the fix in detail.')
    expect(trailers).toEqual([
      { key: 'Change-Id', value: CHANGE_ID },
      { key: 'Signed-off-by', value: 'Ann Author <ann@example.com>' },
    ])
  })

  it('handles a body that is only a trailer block', () => {
    const { text, trailers } = splitTrailers(`Change-Id: ${CHANGE_ID}`)
    expect(text).toBe('')
    expect(trailers).toEqual([{ key: 'Change-Id', value: CHANGE_ID }])
  })

  it('treats a mixed final paragraph as prose', () => {
    const body = 'Some text.\n\nThis line is prose\nChange-Id: ' + CHANGE_ID
    expect(splitTrailers(body)).toEqual({ text: body, trailers: [] })
  })

  it('folds indented continuation lines into the previous trailer', () => {
    const body = 'Prose.\n\nCc: Someone <someone@example.com>,\n  Someone Else <else@example.com>'
    const { trailers } = splitTrailers(body)
    expect(trailers).toEqual([
      { key: 'Cc', value: 'Someone <someone@example.com>, Someone Else <else@example.com>' },
    ])
  })

  it('handles empty input', () => {
    expect(splitTrailers('')).toEqual({ text: '', trailers: [] })
  })
})

describe('findCommitByChangeId', () => {
  it('returns the newest (first) matching commit', () => {
    const commits = [
      { sha: 'new', changeId: CHANGE_ID },
      { sha: 'old', changeId: CHANGE_ID },
      { sha: 'other' },
    ]
    expect(findCommitByChangeId(commits, CHANGE_ID)).toBe('new')
  })

  it('returns null when nothing matches', () => {
    expect(findCommitByChangeId([{ sha: 'a' }], CHANGE_ID)).toBeNull()
  })
})
