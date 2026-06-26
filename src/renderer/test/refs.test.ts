import { describe, it, expect } from 'vitest'
import { groupRefs, pickPrimaryRefGroup, branchBaseName } from '../lib/refs'

describe('groupRefs', () => {
  it('collapses HEAD + local + remote of the same branch into one group', () => {
    const groups = groupRefs(['HEAD', 'main', 'origin/main', 'tag: v1.0'], new Set())
    expect(groups).toHaveLength(2)

    const main = groups.find((g) => g.name === 'main')!
    expect(main).toBeDefined()
    expect(main.isHead).toBe(true)
    expect(main.hasLocal).toBe(true)
    expect(main.hasRemote).toBe(true)
    expect(main.isTag).toBe(false)

    const tag = groups.find((g) => g.isTag)!
    expect(tag.name).toBe('v1.0')
  })

  it('marks worktree-checked-out branches', () => {
    const groups = groupRefs(['feature'], new Set(['feature']))
    expect(groups[0].hasWorktree).toBe(true)
  })

  it('skips remote symbolic HEAD refs', () => {
    const groups = groupRefs(['origin/HEAD', 'origin/main'], new Set())
    expect(groups.find((g) => g.tooltip.includes('origin/HEAD'))).toBeUndefined()
    expect(groups.find((g) => g.name === 'main')?.hasRemote).toBe(true)
  })

  it('produces a single group (no +N overflow) for one ref', () => {
    const groups = groupRefs(['HEAD', 'main'], new Set())
    expect(groups).toHaveLength(1)
    expect(groups.length - 1).toBe(0) // overflow count
  })
})

describe('pickPrimaryRefGroup', () => {
  it('prefers HEAD, then local branch, then tag', () => {
    const groups = groupRefs(['HEAD', 'develop', 'origin/feature', 'tag: v2'], new Set())
    // HEAD points at develop → develop is primary
    expect(pickPrimaryRefGroup(groups)!.name).toBe('develop')
  })

  it('falls back to a local branch when no HEAD', () => {
    const groups = groupRefs(['tag: v3', 'feature-x'], new Set())
    expect(pickPrimaryRefGroup(groups)!.name).toBe('feature-x')
  })
})

describe('branchBaseName', () => {
  it('strips the remote segment', () => {
    expect(branchBaseName('origin/feature/foo')).toBe('feature/foo')
    expect(branchBaseName('main')).toBe('main')
  })
})
