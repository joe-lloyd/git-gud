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

  // Regression for a real-repo lane bug: a commit can fork its parent to another lane,
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

  // ── Issue 1: false edges ───────────────────────────────────────────────────
  // A sibling that forks back to a shared parent keeps its own column busy all
  // the way down to that parent's row (the fork's vertical run is drawn there).
  // Reusing it for an unrelated commit put that commit *on* the line, reading
  // as a parent/child link that does not exist.
  it('does not park an unrelated commit inside a lane a fork line runs through', () => {
    // A and C both have parent P three rows down; X is an unrelated branch tip.
    const commits = [
      node('A', ['P']),
      node('C', ['P']),
      node('X', ['Y']),
      node('P', []),
      node('Y', []),
    ]
    const nodes = buildGraphLayout(commits)
    expect(laneOf(nodes, 'A')).toBe(0)
    expect(laneOf(nodes, 'C')).toBe(1)
    // C's fork occupies lane 1 down to P's row, so X must not land there.
    expect(laneOf(nodes, 'X')).not.toBe(laneOf(nodes, 'C'))
  })

  it('gives every child of a shared parent its own lane', () => {
    const commits = [
      node('A', ['P']),
      node('B', ['P']),
      node('C', ['P']),
      node('P', []),
    ]
    const nodes = buildGraphLayout(commits)
    const lanes = ['A', 'B', 'C'].map((s) => laneOf(nodes, s))
    expect(new Set(lanes).size).toBe(3)
    // All three converge on P, which keeps the leftmost lane.
    expect(laneOf(nodes, 'P')).toBe(0)
  })

  it('routes a merge parent into its own lane and back', () => {
    // M merges F into the mainline; F sits beside the trunk until it rejoins.
    const commits = [
      node('M', ['A', 'F']),
      node('A', ['B']),
      node('F', ['B']),
      node('B', []),
    ]
    const nodes = buildGraphLayout(commits)
    expect(laneOf(nodes, 'M')).toBe(0)
    expect(laneOf(nodes, 'A')).toBe(0)
    expect(laneOf(nodes, 'F')).not.toBe(0)
    expect(laneOf(nodes, 'B')).toBe(0)
    const merge = nodes[0].parentConnections.find((c) => c.parentSha === 'F')!
    expect(merge.type).toBe('merge')
    expect(merge.parentLane).toBe(laneOf(nodes, 'F'))
  })

  // ── Issue 2: lane compaction ──────────────────────────────────────────────
  it('slides a stranded trajectory back to the left once inner lanes free up', () => {
    // Tip A occupies lane 0 but its history ends at row 2. Tip B is pushed out
    // to lane 1 and then runs on alone — it should reclaim lane 0.
    const commits = [
      node('A', ['A1']),
      node('B', ['B1']),
      node('A1', []),   // row 2 — A's history ends here
      node('B1', ['B2']),
      node('B2', []),
    ]
    const nodes = buildGraphLayout(commits)
    expect(laneOf(nodes, 'A')).toBe(0)
    expect(laneOf(nodes, 'B')).toBe(1)
    expect(laneOf(nodes, 'A1')).toBe(0)
    expect(laneOf(nodes, 'B1')).toBe(0) // compacted left
    expect(laneOf(nodes, 'B2')).toBe(0)
  })

  it('does not compact into a lane that is still carrying a line', () => {
    const commits = [
      node('A', ['A1']),  // lane 0, runs down to row 3
      node('B', ['B1']),  // lane 1
      node('B1', ['B2']), // lane 0 still busy — must stay at lane 1
      node('A1', []),
      node('B2', []),
    ]
    const nodes = buildGraphLayout(commits)
    expect(laneOf(nodes, 'B1')).toBe(1)
    expect(laneOf(nodes, 'A1')).toBe(0)
  })

  // A merge edge is drawn vertically down the PARENT's column from the merge
  // commit's row, so compacting that parent leftward is only safe when the
  // target column was free for that whole span.
  it('keeps a merge parent out of a column occupied above it', () => {
    const commits = [
      node('M', ['A', 'F']), // row 0 — merge, second parent F
      node('A', ['B']),      // row 1 — lane 0
      node('B', ['C']),      // row 2 — lane 0
      node('C', []),         // row 3 — lane 0
      node('F', []),         // row 4 — F's own row; lane 0 is free *here*…
    ]
    const nodes = buildGraphLayout(commits)
    // …but not over rows 0–3, where the merge line would have to run.
    expect(laneOf(nodes, 'F')).not.toBe(0)
    const merge = nodes[0].parentConnections.find((c) => c.parentSha === 'F')!
    expect(merge.parentLane).toBe(laneOf(nodes, 'F'))
  })

  it('reports the parent lane a commit actually ended up in', () => {
    // B1 compacts from lane 1 to lane 0, so B's connection must follow it.
    const nodes = buildGraphLayout([
      node('A', ['A1']),
      node('B', ['B1']),
      node('A1', []),
      node('B1', []),
    ])
    const conn = nodes[1].parentConnections[0]
    expect(conn.parentLane).toBe(laneOf(nodes, 'B1'))
    expect(conn.type).toBe('fork')
  })

  it('ignores parents outside the loaded window instead of burning a lane', () => {
    // P is beyond the log limit — it must not reserve a column.
    const nodes = buildGraphLayout([node('A', ['P']), node('B', [])])
    expect(nodes[0].parentConnections[0].parentRow).toBe(-1)
    expect(laneOf(nodes, 'B')).toBe(0)
  })
})
