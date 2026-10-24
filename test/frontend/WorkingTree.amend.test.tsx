import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { WorkingTree } from '../../src/renderer/components/WorkingTree/WorkingTree'

// A commit pushed for review sits on refs/for/main, so the branch is still ahead of origin/main.
const underReview = { staged: [], unstaged: [], untracked: [], branch: 'main', ahead: 1, behind: 0, inBisect: false }

const tree = (gerritMode: boolean) => (
  <WorkingTree repoPath="/repo" status={underReview} gerritMode={gerritMode}
    onRefresh={() => {}} onCommitted={() => {}} onSelectDiff={() => {}} onCommitRun={() => {}} />
)

describe('WorkingTree amend hint', () => {
  beforeEach(() => {
    ;(window.gitApi as any).getCommitMessage = vi.fn().mockResolvedValue('docs: describe the station search\n\nChange-Id: I0b9e')
  })

  it('tells a Gerrit user the amend becomes a new patchset, even with the commit ahead of its upstream', async () => {
    render(tree(true))
    fireEvent.click(screen.getByText('Amend last commit'))
    expect(await screen.findByText(/Amending creates a new patchset when pushed for review/)).toBeInTheDocument()
  })

  it('stays quiet outside Gerrit mode while the commit is unpushed', async () => {
    render(tree(false))
    fireEvent.click(screen.getByText('Amend last commit'))
    await screen.findByDisplayValue('docs: describe the station search')
    expect(screen.queryByText(/new patchset/)).toBeNull()
  })
})
