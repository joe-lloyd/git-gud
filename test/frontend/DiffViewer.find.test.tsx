import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DiffViewer } from '../../src/renderer/components/DiffViewer/DiffViewer'

vi.mock('../../src/renderer/components/Toast/Toast', () => ({
  useToasts: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), toasts: [], remove: vi.fn() }),
}))

const diff = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,3 @@',
  ' const needle = 1',
  '-const old = needle',
  '+const fresh = NEEDLE + needle',
  ' export {}',
  '',
].join('\n')

const marks = () => Array.from(document.querySelectorAll<HTMLElement>('mark.find-mark'))
const activeMarks = () => Array.from(document.querySelectorAll<HTMLElement>('mark.find-mark-active'))
const pressFind = () => fireEvent.keyDown(window, { key: 'f', metaKey: true })
// Rows are syntax highlighted (text split across spans), so wait on the table.
const loaded = () => waitFor(() => expect(document.querySelectorAll('tr.diff-line').length).toBeGreaterThan(0))

describe('DiffViewer in-file find', () => {
  beforeEach(() => {
    vi.mocked(window.gitApi.getFileDiff).mockResolvedValue({ diff })
    ;(window.gitApi as any).getFileDiffSources = vi.fn().mockResolvedValue(null)
    ;(window.gitApi as any).getCommitFileDiffSources = vi.fn().mockResolvedValue(null)
  })

  it('opens the find bar on Cmd+F and marks every hit in the visible diff', async () => {
    render(<DiffViewer filePath="src/a.ts" onClose={() => {}} />)
    await loaded()
    expect(screen.queryByLabelText('Find in file')).toBeNull()

    pressFind()
    const input = screen.getByRole('textbox', { name: 'Find in file' }) as HTMLInputElement
    expect(document.activeElement).toBe(input)

    fireEvent.change(input, { target: { value: 'needle' } })
    await waitFor(() => expect(marks()).toHaveLength(4))
    expect(screen.getByText('1 / 4')).toBeInTheDocument()
    // Every mark is a case-insensitive hit on the literal query.
    expect(marks().map((m) => m.textContent!.toLowerCase())).toEqual(['needle', 'needle', 'needle', 'needle'])
    // First hit is active; hunk header and file headers are never searched.
    expect(activeMarks()).toHaveLength(1)
    expect(activeMarks()[0].closest('tr')!.className).toContain('diff-line-context')
  })

  it('cycles with Enter / Shift+Enter and wraps around', async () => {
    render(<DiffViewer filePath="src/a.ts" onClose={() => {}} />)
    await loaded()
    pressFind()
    const input = screen.getByRole('textbox', { name: 'Find in file' })
    fireEvent.change(input, { target: { value: 'needle' } })
    await waitFor(() => expect(marks()).toHaveLength(4))

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('2 / 4')).toBeInTheDocument()
    expect(activeMarks()[0].closest('tr')!.className).toContain('diff-line-remove')

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(screen.getByText('4 / 4')).toBeInTheDocument()
    expect(activeMarks()[0].closest('tr')!.className).toContain('diff-line-add')
  })

  it('reports no matches and never touches the row text otherwise', async () => {
    render(<DiffViewer filePath="src/a.ts" onClose={() => {}} />)
    await loaded()
    pressFind()
    fireEvent.change(screen.getByRole('textbox', { name: 'Find in file' }), { target: { value: 'zzz' } })
    expect(screen.getByText('No matches')).toBeInTheDocument()
    expect(marks()).toHaveLength(0)
  })

  it('Escape closes only the find bar, a second Escape closes the diff', async () => {
    const onClose = vi.fn()
    render(<DiffViewer filePath="src/a.ts" onClose={onClose} />)
    await loaded()
    pressFind()
    const input = screen.getByRole('textbox', { name: 'Find in file' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Find in file' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not fire the hunk shortcuts while typing in the find input', async () => {
    render(<DiffViewer filePath="src/a.ts" onClose={() => {}} />)
    await loaded()
    pressFind()
    const input = screen.getByRole('textbox', { name: 'Find in file' })
    fireEvent.keyDown(input, { key: 's' })
    fireEvent.keyDown(input, { key: 'd' })
    expect(window.gitApi.applyPatch).not.toHaveBeenCalled()
  })
})
