import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BisectWizard } from '../../src/renderer/components/Bisect/BisectWizard'

const commits = [
  { sha: 'c3'.padEnd(40, '0'), shortSha: 'c3', message: 'third' },
  { sha: 'c2'.padEnd(40, '0'), shortSha: 'c2', message: 'second' },
  { sha: 'c1'.padEnd(40, '0'), shortSha: 'c1', message: 'first' },
] as any

describe('BisectWizard', () => {
  let calls: string[]
  beforeEach(() => {
    calls = []
    ;(window.gitApi as any).bisectStart = vi.fn(async () => { calls.push('start') })
    ;(window.gitApi as any).bisectBad = vi.fn(async (sha?: string) => { calls.push(`bad ${sha ?? 'HEAD'}`); return '' })
    ;(window.gitApi as any).bisectGood = vi.fn(async (sha?: string) => {
      calls.push(`good ${sha ?? 'HEAD'}`)
      return calls.length > 3 ? `${commits[1].sha} is the first bad commit` : `Bisecting: 0 revisions left to test after this (roughly 1 step)\n[${commits[1].sha}] second`
    })
    ;(window.gitApi as any).bisectReset = vi.fn(async () => {})
  })

  it('treats a blank bad commit as HEAD, then marks whatever git checked out', async () => {
    const onStep = vi.fn()
    render(<BisectWizard commits={commits} onClose={() => {}} onStep={onStep} />)
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: commits[2].sha } })
    fireEvent.click(screen.getByRole('button', { name: 'Start Bisect' }))

    // git needs a bad commit before it checks anything out.
    await waitFor(() => expect(calls).toEqual(['start', 'bad HEAD', `good ${commits[2].sha}`]))
    expect(await screen.findByText(/\[c2.*\] second/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Good/ }))
    await waitFor(() => expect(calls.at(-1)).toBe('good HEAD'))
    expect(await screen.findByText(/Found the first bad commit/)).toBeInTheDocument()
    expect(onStep).toHaveBeenCalledTimes(2)
  })
})
