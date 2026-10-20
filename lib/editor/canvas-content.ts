import type { ImageState } from '@/lib/store'
import { hasVisibleMockups, shouldRenderSourceImage } from '@/lib/device-mockups/layouts'

/** Keep the stage and export controls available for every supported composition. */
export function hasCanvasContent(state: ImageState): boolean {
  return Boolean(
    (state.uploadedImageUrl && shouldRenderSourceImage(state.editorMode, state.mockups)) ||
    (state.editorMode === 'device' && hasVisibleMockups(state.mockups)) ||
    state.textOverlays.length ||
    state.imageOverlays.length ||
    state.elements.length ||
    state.annotations.length ||
    state.blurRegions.length
  )
}
