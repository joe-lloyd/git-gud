import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ConsoleDock } from '../../src/renderer/components/ConsoleDock/ConsoleDock'

type Activity = Parameters<Parameters<typeof window.gitApi.onGitActivity>[0]>[0]

describe('ConsoleDock while hidden', () => {
  let emit: (rec: Activity) => void = () => {}

  beforeEach(() => {
    ;(window.gitApi as any).onGitActivity = vi.fn((cb: (rec: Activity) => void) => { emit = cb; return () => {} })
    ;(window.gitApi as any).onConsoleOutput = vi.fn(() => () => {})
    ;(window.gitApi as any).getRepoRoot = vi.fn().mockResolvedValue('/repo')
  })

  const dock = (visible: boolean) => (
    <ConsoleDock visible={visible} repoPath="/repo" height={240} splitPct={50}
      onVDragStart={() => {}} onSplitDragStart={() => {}} onClose={() => {}} />
  )

  it('keeps recording git activity, and shows it when opened', async () => {
    const { container, rerender } = render(dock(false))
    expect(container.querySelector<HTMLElement>('.console-dock')!.style.display).toBe('none')

    act(() => emit({ id: '1', repoPath: '/repo', args: ['cherry-pick', 'abc1234'], output: '[main 1d58944] spike', failed: false, kind: 'write', durationMs: 40, ts: Date.now() } as Activity))

    rerender(dock(true))
    expect(container.querySelector<HTMLElement>('.console-dock')!.style.display).toBe('')
    expect(await screen.findByText(/git cherry-pick abc1234/)).toBeInTheDocument()
  })
})
