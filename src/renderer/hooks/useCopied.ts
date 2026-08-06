import { useCallback, useEffect, useRef, useState } from 'react'

// Shared "copied ✓" affordance: `copy()` writes to the clipboard and flips
// `copied` on for a beat so the triggering button can show in-place feedback
// (icon → check, label → "Copied"). Every copy button in the app goes through
// this so the interaction feels identical everywhere.
export function useCopied(resetMs = 1500) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  // For callers whose clipboard write happens elsewhere — just the flash.
  const flash = useCallback(() => {
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), resetMs)
  }, [resetMs])

  const copy = useCallback(async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return false
    }
    flash()
    return true
  }, [flash])

  return { copied, copy, flash }
}
