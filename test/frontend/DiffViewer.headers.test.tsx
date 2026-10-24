import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { DiffViewer } from '../../src/renderer/components/DiffViewer/DiffViewer'

vi.mock('../../src/renderer/components/Toast/Toast', () => ({
  useToasts: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), toasts: [], remove: vi.fn() }),
}))

const diff = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 28248f6..48d11e1 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,2 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  '',
].join('\n')

// The text a row shows, without the Stage/Discard chunk buttons on the hunk row.
const rowText = (row: Element) => row.querySelector('.diff-content')!.firstChild!.textContent

describe('DiffViewer header rows', () => {
  beforeEach(() => {
    vi.mocked(window.gitApi.getFileDiff).mockResolvedValue({ diff })
    ;(window.gitApi as any).getFileDiffSources = vi.fn().mockResolvedValue(null)
    ;(window.gitApi as any).getCommitFileDiffSources = vi.fn().mockResolvedValue(null)
  })

  it('shows file and hunk headers whole, with no character cut off', async () => {
    render(<DiffViewer filePath="src/a.ts" onClose={() => {}} />)
    await waitFor(() => expect(document.querySelectorAll('tr.diff-line').length).toBeGreaterThan(0))
    const headers = Array.from(document.querySelectorAll('tr.diff-line-header, tr.diff-line-hunk')).map(rowText)
    expect(headers).toEqual([
      'diff --git a/src/a.ts b/src/a.ts',
      'index 28248f6..48d11e1 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,2 @@',
    ])
  })
})
