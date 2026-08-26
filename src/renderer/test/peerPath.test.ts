import { describe, it, expect } from 'vitest'
import { isPeerPath, parsePeerPath, peerRepoName, peerDisplayPath } from '../lib/peerPath'

// Renderer twin of main/peer-protocol — must agree with it byte for byte.
describe('peerPath (renderer twin)', () => {
  it('recognizes and parses peer URIs', () => {
    expect(isPeerPath('gitgud-peer://abc/Users/joe/app')).toBe(true)
    expect(isPeerPath('/Users/joe/app')).toBe(false)
    expect(isPeerPath(null)).toBe(false)
    expect(parsePeerPath('gitgud-peer://abc/Users/joe/app')).toEqual({ peerId: 'abc', remotePath: '/Users/joe/app' })
    expect(parsePeerPath('gitgud-peer://abc/C:/code/app')).toEqual({ peerId: 'abc', remotePath: 'C:/code/app' })
    expect(parsePeerPath('gitgud-peer://abc/')).toBeNull()
    expect(parsePeerPath('nope')).toBeNull()
  })

  it('derives display names like local paths do', () => {
    expect(peerRepoName('gitgud-peer://abc/C:/code/app')).toBe('app')
    expect(peerRepoName('gitgud-peer://abc/Users/joe/git-gud')).toBe('git-gud')
    expect(peerDisplayPath('gitgud-peer://abc/C:/code/app')).toBe('C:/code/app')
    expect(peerDisplayPath('/local/x')).toBe('/local/x')
  })
})
