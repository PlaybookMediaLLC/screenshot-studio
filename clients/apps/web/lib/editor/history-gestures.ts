'use client'

import { useEffect } from 'react'
import { endHistoryGesture, startHistoryGesture } from '@/lib/store'

/**
 * Group every pointer gesture in the editor into one undo step, so dragging a
 * slider or a layer undoes in one ⌘Z instead of one per frame.
 */
export function useHistoryGestures() {
  useEffect(() => {
    window.addEventListener('pointerdown', startHistoryGesture, true)
    window.addEventListener('pointerup', endHistoryGesture, true)
    window.addEventListener('pointercancel', endHistoryGesture, true)
    window.addEventListener('blur', endHistoryGesture)
    return () => {
      window.removeEventListener('pointerdown', startHistoryGesture, true)
      window.removeEventListener('pointerup', endHistoryGesture, true)
      window.removeEventListener('pointercancel', endHistoryGesture, true)
      window.removeEventListener('blur', endHistoryGesture)
      endHistoryGesture()
    }
  }, [])
}
