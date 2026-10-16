'use client'

import { toast } from 'sonner'
import { useImageStore } from '@/lib/store'

/**
 * Remove the screenshot, keeping the design around it, and offer Undo.
 * Removing one layer does not need a confirmation dialog; resetting the whole
 * design does (Start over).
 */
export function removeScreenshot() {
  const { uploadedImageUrl, removeMainImage } = useImageStore.getState()
  if (!uploadedImageUrl) return
  removeMainImage()
  toast('Screenshot removed', {
    action: { label: 'Undo', onClick: () => useImageStore.temporal.getState().undo() },
    description: 'The design stays; add another screenshot or undo.',
  })
}
