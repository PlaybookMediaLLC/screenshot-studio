import { getAspectRatioPreset } from '@/lib/aspect-ratio-utils'
import type { DesignDocument } from '@/lib/design/document'
import { type ScreenShape, screenBoxAspect } from './geometry'
import { type CompositionLayoutId, layoutScreens } from './layouts'

/** A screen with a place on the canvas. */
type PlacedScreen = ScreenShape & {
  position: { x: number; y: number }
  rotation: number
  size: number
}

/** Screens moved and sized by a composition layout; everything else about them is kept. */
export function arrangeScreens<Screen extends PlacedScreen>(
  screens: readonly Screen[],
  layout: CompositionLayoutId,
  canvasAspect: number
): Screen[] {
  const slots = layoutScreens(layout, screens.map(screenBoxAspect), canvasAspect)
  return screens.map((screen, index) => {
    const slot = slots[index]!
    return {
      ...screen,
      position: { x: slot.x, y: slot.y },
      rotation: slot.rotation,
      size: slot.size,
    }
  })
}

/** A document's canvas width / height. */
export function documentCanvasAspect(document: DesignDocument): number {
  const canvas = document.canvas
  if (canvas?.aspectRatio === 'custom' && canvas.size) return canvas.size.width / canvas.size.height
  const preset = getAspectRatioPreset(canvas?.aspectRatio ?? '4_3')
  return preset ? preset.width / preset.height : 4 / 3
}

/**
 * The document with its screens arranged by a composition layout: what
 * applying the layout produces, for its preview thumbnail.
 */
export function withCompositionLayout(
  document: DesignDocument,
  layout: CompositionLayoutId
): DesignDocument {
  const devices = document.devices
  if (!devices || devices.mockups.length === 0) return document
  return {
    ...document,
    devices: {
      ...devices,
      layoutId: layout,
      mockups: arrangeScreens(devices.mockups, layout, documentCanvasAspect(document)),
    },
    mode: 'device',
  }
}
