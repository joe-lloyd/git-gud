import { describe, it, expect } from 'vitest'
import { groupRefs, GERRIT_CHANGE_REF_PREFIX } from '../lib/refs'
import {
  DEFAULT_REF_VISIBILITY,
  RefVisibility,
  filterRefGroups,
  normalizeRefVisibility,
  refsColumnHidden,
} from '../lib/refFilter'

const vis = (patch: Partial<RefVisibility>): RefVisibility => ({ ...DEFAULT_REF_VISIBILITY, ...patch })

const groups = () =>
  groupRefs(
    ['HEAD', 'main', 'origin/main', 'origin/feature', 'tag: v1.0.0', `${GERRIT_CHANGE_REF_PREFIX}1234`],
    new Set(),
  )

const names = (gs: ReturnType<typeof groups>) => gs.map((g) => g.name).sort()

describe('filterRefGroups', () => {
  it('shows everything by default', () => {
    expect(names(filterRefGroups(groups(), DEFAULT_REF_VISIBILITY))).toEqual(
      ['#1234', 'feature', 'main', 'v1.0.0'].sort(),
    )
  })

  it('turning every kind off hides all pills', () => {
    expect(filterRefGroups(groups(), vis({ local: false, remote: false, tags: false, gerrit: false }))).toEqual([])
  })

  it('hides tags only', () => {
    expect(names(filterRefGroups(groups(), vis({ tags: false })))).toEqual(
      ['#1234', 'feature', 'main'].sort(),
    )
  })

  it('hides Gerrit change pills only', () => {
    expect(names(filterRefGroups(groups(), vis({ gerrit: false })))).toEqual(
      ['feature', 'main', 'v1.0.0'].sort(),
    )
  })

  it('keeps a branch that exists locally when remotes are hidden', () => {
    // "main" is local + remote → survives; "feature" is remote-only → gone.
    expect(names(filterRefGroups(groups(), vis({ remote: false })))).toEqual(
      ['#1234', 'main', 'v1.0.0'].sort(),
    )
  })

  it('keeps a branch that exists remotely when locals are hidden', () => {
    expect(names(filterRefGroups(groups(), vis({ local: false })))).toEqual(
      ['#1234', 'feature', 'main', 'v1.0.0'].sort(),
    )
  })

  it('treats a detached HEAD pill as local', () => {
    const detached = groupRefs(['HEAD'], new Set())
    expect(filterRefGroups(detached, vis({ local: true })).map((g) => g.name)).toEqual(['HEAD'])
    expect(filterRefGroups(detached, vis({ local: false }))).toEqual([])
  })
})

describe('refsColumnHidden', () => {
  it('is false while any kind is on', () => {
    expect(refsColumnHidden(DEFAULT_REF_VISIBILITY)).toBe(false)
    expect(refsColumnHidden(vis({ local: false, remote: false, tags: false }))).toBe(false)
  })

  it('is true only when every kind is off', () => {
    expect(refsColumnHidden(vis({ local: false, remote: false, tags: false, gerrit: false }))).toBe(true)
  })
})

describe('normalizeRefVisibility', () => {
  it('falls back for junk and partial blobs', () => {
    expect(normalizeRefVisibility(null)).toEqual(DEFAULT_REF_VISIBILITY)
    expect(normalizeRefVisibility('nope')).toEqual(DEFAULT_REF_VISIBILITY)
    expect(normalizeRefVisibility({ tags: false, bogus: 1 })).toEqual(vis({ tags: false }))
  })

  it('keeps tool-private namespaces out of the graph by default', () => {
    expect(DEFAULT_REF_VISIBILITY.otherRefs).toBe(false)
    // A blob saved before this setting existed must not silently switch it on.
    expect(normalizeRefVisibility({ local: true }).otherRefs).toBe(false)
  })
})
