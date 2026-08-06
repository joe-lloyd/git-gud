import React from 'react'
import { Icon } from '../Icons/Icon'
import { useCopied } from '../../hooks/useCopied'

interface CopyButtonProps {
  /** Text to copy — pass a function when building it is non-trivial. */
  text: string | (() => string)
  /** Visible label next to the icon; icon-only when omitted. */
  label?: string
  className?: string
  size?: number
  title?: string
}

// The standard copy button: click → clipboard write → icon flips to ✓
// ("Copied" when labelled) for a beat. Use `useCopied` directly for buttons
// that can't take this shape.
export const CopyButton: React.FC<CopyButtonProps> = ({
  text, label, className = 'btn btn-ghost', size = 13, title = 'Copy to clipboard',
}) => {
  const { copied, copy } = useCopied()
  return (
    <button
      className={`${className}${copied ? ' is-copied' : ''}`}
      title={title}
      onClick={() => copy(typeof text === 'function' ? text() : text)}
    >
      <Icon name={copied ? 'check' : 'copy'} size={size} />
      {label && (copied ? 'Copied' : label)}
    </button>
  )
}
