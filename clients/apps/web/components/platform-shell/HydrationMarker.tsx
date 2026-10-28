'use client'

import { useEffect } from 'react'

/**
 * Marks the document once React has hydrated it. Browser tests wait for
 * `html[data-hydrated]` before they act, so a click never lands before its
 * handler is attached.
 */
export function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true'
  }, [])
  return null
}
