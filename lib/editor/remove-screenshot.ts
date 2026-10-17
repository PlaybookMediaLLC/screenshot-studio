'use client'

import { toast } from 'sonner'
import { useImageStore } from '@/lib/store'

/**
 * Remove the screenshot, keeping the design around it, and offer Undo.
 * Removing one layer does not need a confirmation dialog; resetting the whole
 * design does (Start over).
 */
export function removeScreenshot() {
  const { activeSlideId, imageName, removeMainImage, slides, uploadedImageUrl } =
    useImageStore.getState()
  if (!uploadedImageUrl) return
  removeMainImage()
  // Undo puts back exactly what was removed, even after later edits.
  const restore = () =>
    useImageStore.setState({ activeSlideId, imageName, slides, uploadedImageUrl })
  toast('Screenshot removed', {
    action: { label: 'Undo', onClick: restore },
    description: 'The design stays; add another screenshot, or undo with ⌘Z.',
  })
}
