import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ContextMenu } from '../../src/renderer/components/ContextMenu/ContextMenu'

const actions = [{ label: 'Checkout', onClick: () => {} }, { label: 'Create tag here…', onClick: () => {} }]

// jsdom has no layout, so give the menu the size a real one has.
const sized = (width: number, height: number) =>
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON: () => ({}) })

const menuStyle = () => {
  const el = document.querySelector<HTMLElement>('.cm-menu')!
  return { left: el.style.left, top: el.style.top }
}

describe('ContextMenu placement', () => {
  afterEach(() => vi.restoreAllMocks())

  it('opens at the cursor when it fits', () => {
    sized(200, 300)
    render(<ContextMenu x={100} y={120} actions={actions} onClose={() => {}} />)
    expect(menuStyle()).toEqual({ left: '100px', top: '120px' })
  })

  it('moves up and left to stay inside the window near the bottom-right corner', () => {
    sized(200, 300)
    render(<ContextMenu x={window.innerWidth - 50} y={window.innerHeight - 40} actions={actions} onClose={() => {}} />)
    expect(menuStyle()).toEqual({ left: `${window.innerWidth - 208}px`, top: `${window.innerHeight - 308}px` })
  })
})
