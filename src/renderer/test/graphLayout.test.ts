import { describe, it, expect } from 'vitest'
import { buildGraphLayout } from '../components/Graph/graphLayout'
import type { CommitNode } from '../../preload/index'

const node = (sha: string, parents: string[]): CommitNode => ({
  sha, shortSha: sha.slice(0, 7), message: sha, author: 'a', email: 'e',
  date: '', timestamp: 0, parents, refs: [],
})

const laneOf = (nodes: ReturnType<typeof buildGraphLayout>, sha: string) =>
  nodes.find((n) => n.commit.sha === sha)!.lane

describe('buildGraphLayout', () => {
  it('keeps a linear history in a single lane', () => {
    const nodes = buildGraphLayout([node('C', ['B']), node('B', ['A']), node('A', [])])
    expect(laneOf(nodes, 'C')).toBe(0)
    expect(laneOf(nodes, 'B')).toBe(0)
    expect(laneOf(nodes, 'A')).toBe(0)
  })

  it('continues the first parent in the same lane (mainline)', () => {
    const nodes = buildGraphLayout([node('C', ['B']), node('B', [])])
    expect(laneOf(nodes, 'B')).toBe(laneOf(nodes, 'C'))
  })

  // Regression for the Boba2 bug: a commit can fork its parent to another lane,
  // freeing its own column; an immediately-following stash must NOT reuse that
  // freed lane (which made the stash look like a child of the unrelated commit).
  it('gives a stash its own column instead of reusing an unrelated freed lane', () => {
    // A and C share parent P. A claims P's mainline lane; C is pushed to lane 1
    // but forks back to P — freeing lane 1. A stash S follows.
    const commits = [
      node('A', ['P']),
      node('C', ['P']),
      node('S', ['Q']),   // unrelated stash
      node('P', []),
      node('Q', []),
    ]
    const nodes = buildGraphLayout(commits, new Set(['S']))
    expect(laneOf(nodes, 'S')).not.toBe(laneOf(nodes, 'C'))
    expect(laneOf(nodes, 'S')).not.toBe(laneOf(nodes, 'A'))
  })

  it('a stash dangles in its own lane and does not perturb the trunk', () => {
    // Newest → oldest: tip C, a stash S, then the trunk B, A.
    const nodes = buildGraphLayout(
      [node('C', ['B']), node('S', ['B', 'idx']), node('B', ['A']), node('A', [])],
      new Set(['S']),
    )
    expect(laneOf(nodes, 'C')).toBe(0)
    expect(laneOf(nodes, 'B')).toBe(0)
    expect(laneOf(nodes, 'A')).toBe(0)
    expect(laneOf(nodes, 'S')).not.toBe(0) // stash is off-trunk in its own column
  })

  it('treats a non-stash node normally even with a stash set provided', () => {
    const nodes = buildGraphLayout([node('C', ['B']), node('B', [])], new Set(['somethingElse']))
    expect(laneOf(nodes, 'B')).toBe(laneOf(nodes, 'C'))
  })
})
