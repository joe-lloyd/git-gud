import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ConflictEditor } from '../../src/renderer/components/ConflictEditor/ConflictEditor'
import type { ConflictFile } from '../../src/preload/index'

vi.mock('../../src/renderer/components/Toast/Toast', () => ({
  useToasts: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), toasts: [], remove: vi.fn() }),
}))

// A realistic two-block TypeScript conflict: block 1 differs by one token per
// line, block 2 has a line both sides share plus one that differs.
const file: ConflictFile = {
  path: 'src/app.ts',
  sections: [
    { kind: 'shared', text: 'export const defaults = {' },
    { kind: 'conflict', current: '  retries: 5,', incoming: '  retries: 3,', currentLabel: 'HEAD', incomingLabel: 'topic' },
    { kind: 'shared', text: '}\n\nexport function greet(name: string) {' },
    {
      kind: 'conflict',
      current: "  logger.info('greet')\n  return `Hello, ${name}!`",
      incoming: "  logger.info('greet')\n  return `Hi ${name}`",
      currentLabel: 'HEAD', incomingLabel: 'topic',
    },
    { kind: 'shared', text: '}' },
  ],
}

const resolvedRows = () => Array.from(document.querySelectorAll<HTMLElement>('.ce-rline'))
const textarea = () => screen.getByLabelText('Resolved file content') as HTMLTextAreaElement

describe('ConflictEditor', () => {
  beforeEach(() => {
    vi.mocked(window.gitApi.getConflictFile).mockResolvedValue(file)
    vi.mocked(window.gitApi.writeFile).mockResolvedValue({ success: true })
    vi.mocked(window.gitApi.markResolved).mockResolvedValue({ success: true })
  })

  it('seeds the result with the current side and paints origin gutters', async () => {
    render(<ConflictEditor filePath="src/app.ts" onClose={() => {}} onResolved={() => {}} />)
    await screen.findByText('2 conflict blocks')
    expect(textarea().value).toBe([
      'export const defaults = {',
      '  retries: 5,',
      '}', '', 'export function greet(name: string) {',
      "  logger.info('greet')",
      '  return `Hello, ${name}!`',
      '}',
    ].join('\n'))
    const rows = resolvedRows()
    expect(rows[0].className).toContain('ce-origin-shared')
    expect(rows[1].className).toContain('ce-origin-current')
    expect(rows[5].className).toContain('ce-origin-both')     // identical on both sides
    expect(rows[6].className).toContain('ce-origin-current')
    // Result pane is syntax highlighted (hljs token spans present).
    expect(rows[0].querySelector('.hljs-keyword')).not.toBeNull()
  })

  it('highlights only the changed words inside a differing block line', async () => {
    render(<ConflictEditor filePath="src/app.ts" onClose={() => {}} onResolved={() => {}} />)
    await screen.findByText('2 conflict blocks')
    const currentPane = document.querySelector('.ce-pane-current')!
    const marks = Array.from(currentPane.querySelectorAll('mark.ce-mark')).map((m) => m.textContent)
    expect(marks).toContain('5')
    // The shared logger line inside block 2 is tinted as "same", the greeting as "changed".
    const lines = Array.from(currentPane.querySelectorAll<HTMLElement>('.ce-side-line-conflict'))
    const logger = lines.find((l) => l.textContent?.includes("logger.info"))!
    const greet = lines.find((l) => l.textContent?.includes('Hello'))!
    expect(logger.className).toContain('ce-line-same')
    expect(greet.className).toContain('ce-line-changed')
  })

  it('"Use this" on the incoming pane swaps just that block in the result', async () => {
    render(<ConflictEditor filePath="src/app.ts" onClose={() => {}} onResolved={() => {}} />)
    await screen.findByText('2 conflict blocks')
    const incomingPane = document.querySelector('.ce-pane-incoming')!
    const heads = within(incomingPane as HTMLElement).getAllByText('Use this')
    fireEvent.click(heads[0])   // block 1
    await waitFor(() => expect(textarea().value).toContain('  retries: 3,'))
    expect(textarea().value).not.toContain('  retries: 5,')
    expect(textarea().value).toContain('return `Hello, ${name}!`')   // block 2 untouched
    expect(resolvedRows()[1].className).toContain('ce-origin-incoming')
    // Legend reflects the new mix: 1 incoming, 1 current, 1 both.
    const legend = document.querySelector('.ce-legend')!
    expect(legend.querySelector('.ce-chip-incoming')!.textContent).toMatch(/incoming\s*1/)
    expect(legend.querySelector('.ce-chip-current')!.textContent).toMatch(/current\s*1/)
  })

  it('"Use both" keeps both sides, current first, and survives a hand edit elsewhere', async () => {
    render(<ConflictEditor filePath="src/app.ts" onClose={() => {}} onResolved={() => {}} />)
    await screen.findByText('2 conflict blocks')
    // Hand-edit the last line first so the block has to be found, not assumed.
    fireEvent.change(textarea(), { target: { value: textarea().value.replace(/\}$/, '} // edited') } })
    fireEvent.click(document.querySelector('.ce-toolbar .ce-action-both')!)   // toolbar: acts on the active block (block 1)
    await waitFor(() => expect(textarea().value).toContain('  retries: 5,\n  retries: 3,'))
    expect(textarea().value.endsWith('} // edited')).toBe(true)
    const rows = resolvedRows()
    expect(rows[rows.length - 1].className).toContain('ce-origin-edited')
  })

  it('warns about leftover markers and counts them', async () => {
    render(<ConflictEditor filePath="src/app.ts" onClose={() => {}} onResolved={() => {}} />)
    await screen.findByText('2 conflict blocks')
    fireEvent.change(textarea(), { target: { value: '<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> topic' } })
    expect(await screen.findByText(/3 conflict markers left/)).toBeInTheDocument()
    expect(resolvedRows()[0].className).toContain('ce-origin-marker')
  })

  it('saves the buffer and marks the file resolved', async () => {
    const onResolved = vi.fn()
    render(<ConflictEditor filePath="src/app.ts" onClose={() => {}} onResolved={onResolved} />)
    await screen.findByText('2 conflict blocks')
    fireEvent.click(screen.getByText('Take all incoming'))
    fireEvent.click(screen.getByText('Save & Mark Resolved'))
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('src/app.ts'))
    expect(window.gitApi.writeFile).toHaveBeenCalledWith('src/app.ts', expect.stringContaining('  retries: 3,'))
    expect(window.gitApi.markResolved).toHaveBeenCalledWith(['src/app.ts'])
  })
})
