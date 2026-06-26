import { describe, it, expect } from 'vitest'
import { worktreeBaseFor, defaultWorktreePath } from '../lib/worktree-path'

describe('worktreeBaseFor', () => {
  it('derives a sibling .worktrees folder', () => {
    expect(worktreeBaseFor('/a/b/proj')).toBe('/a/b/proj.worktrees')
  })

  it('tolerates a trailing slash', () => {
    expect(worktreeBaseFor('/a/b/proj/')).toBe('/a/b/proj.worktrees')
  })

  it('returns empty for empty input', () => {
    expect(worktreeBaseFor('')).toBe('')
  })
})

describe('defaultWorktreePath', () => {
  it('appends the branch under the base', () => {
    expect(defaultWorktreePath('/a/b/proj', 'feature/x')).toBe('/a/b/proj.worktrees/feature/x')
  })

  it('is empty without a branch', () => {
    expect(defaultWorktreePath('/a/b/proj', '')).toBe('')
  })

  it('is empty without a project path', () => {
    expect(defaultWorktreePath('', 'feature')).toBe('')
  })
})
