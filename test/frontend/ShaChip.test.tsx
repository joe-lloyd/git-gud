import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ShaChip } from '../../src/renderer/components/CopyButton/ShaChip'

const FULL = 'a84121d0123456789abcdef0123456789abcdef0'

describe('ShaChip', () => {
  let writeText: ReturnType<typeof vi.fn>
  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  it('shows the short sha and copies the full sha on click', async () => {
    render(<ShaChip sha={FULL} />)
    const btn = screen.getByRole('button', { name: `Copy SHA ${FULL}` })
    expect(btn.textContent).toBe('a84121d')
    fireEvent.click(btn)
    expect(writeText).toHaveBeenCalledWith(FULL)
    await waitFor(() => expect(btn.textContent).toBe('copied'))
    expect(btn.className).toContain('is-copied')
  })

  it('lets the click bubble so a graph row still selects', () => {
    const onRowClick = vi.fn()
    render(<div onClick={onRowClick}><ShaChip sha={FULL} short="a84121d" /></div>)
    fireEvent.click(screen.getByRole('button'))
    expect(onRowClick).toHaveBeenCalledTimes(1)
  })
})
