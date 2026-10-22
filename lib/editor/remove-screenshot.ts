'use client'

import { toast } from 'sonner'
import { useImageStore } from '@/lib/store'

/**
 * Remove the screenshot, keeping the design around it, and offer Undo.
 * Removing one layer does not need a confirmation dialog; resetting the whole
 * design does (Start over).
 */
export function removeScreenshot() {
  const { activeSlideId, imageName, removeMainImage, removeSlide, slides, timeline, uploadedImageUrl } =
    useImageStore.getState()
  if (!uploadedImageUrl) return
  if (activeSlideId) removeSlide(activeSlideId)
  else removeMainImage()
  // Undo puts back exactly what was removed, even after later edits.
  const restore = () =>
    useImageStore.setState({ activeSlideId, imageName, slides, timeline, uploadedImageUrl })
  toast('Screenshot removed', {
    action: { label: 'Undo', onClick: restore },
    description: 'The design stays; add another screenshot, or undo with ⌘Z.',
  })
}
