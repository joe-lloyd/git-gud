import React from 'react'
import { useCopied } from '../../hooks/useCopied'

interface ShaChipProps {
  /** Full 40-char SHA — this is what lands on the clipboard. */
  sha: string
  /** Text shown; defaults to the 7-char abbreviation. */
  short?: string
  className?: string
}

// A SHA rendered as a click-to-copy token. Shows "copied" in place for a beat
// after the click; the parent's own click handling still runs (a graph row
// keeps selecting on click) because we deliberately do not stop propagation.
export const ShaChip: React.FC<ShaChipProps> = ({ sha, short, className = '' }) => {
  const { copied, copy } = useCopied()
  return (
    <button
      type="button"
      className={`sha-chip mono ${className}${copied ? ' is-copied' : ''}`}
      title={copied ? 'Copied full SHA' : `Click to copy ${sha}`}
      aria-label={`Copy SHA ${sha}`}
      onClick={() => { void copy(sha) }}
    >
      {copied ? 'copied' : (short ?? sha.slice(0, 7))}
    </button>
  )
}
