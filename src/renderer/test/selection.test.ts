import { describe, it, expect } from 'vitest'
import { rangeBetween, isContiguous } from '../lib/selection'

const order = ['a', 'b', 'c', 'd', 'e']

describe('rangeBetween', () => {
  it('returns the inclusive range, anchor before target', () => {
    expect(rangeBetween(order, 'b', 'd')).toEqual(['b', 'c', 'd'])
  })

  it('returns the inclusive range, anchor after target', () => {
    expect(rangeBetween(order, 'd', 'b')).toEqual(['b', 'c', 'd'])
  })

  it('single element when anchor === target', () => {
    expect(rangeBetween(order, 'c', 'c')).toEqual(['c'])
  })

  it('falls back to [target] when anchor not found', () => {
    expect(rangeBetween(order, 'z', 'c')).toEqual(['c'])
  })
})

describe('isContiguous', () => {
  it('true for an unbroken run', () => {
    expect(isContiguous(order, ['b', 'c', 'd'])).toBe(true)
  })

  it('order-independent', () => {
    expect(isContiguous(order, ['d', 'b', 'c'])).toBe(true)
  })

  it('false when there is a gap', () => {
    expect(isContiguous(order, ['b', 'd'])).toBe(false)
  })

  it('true for a single selection, false for empty', () => {
    expect(isContiguous(order, ['c'])).toBe(true)
    expect(isContiguous(order, [])).toBe(false)
  })

  it('false when a sha is not in order', () => {
    expect(isContiguous(order, ['b', 'zzz'])).toBe(false)
  })
})
