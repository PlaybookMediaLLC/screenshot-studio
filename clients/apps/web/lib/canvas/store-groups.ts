import { z } from 'zod'
import { storeGroupSchema, type StoreGroup } from '@/lib/creative-sets/store-schema'
import {
  DEFAULT_TARGET_ID,
  getStoreTarget,
  getStoreTargetOrDefault,
  targetPixelSize,
} from '@/lib/store-screenshots/targets'
import type { WorkspaceRect } from './document'

/**
 * App Store and Google Play screenshot groups on a canvas. A group keeps its
 * native store document, drawn and exported by the store renderer exactly as
 * in the screenshots studio and Story Sets; the canvas only places it. Its
 * slides sit in a row at the chosen store size, one workspace unit to one
 * exported pixel, like artboards.
 */

/** Space between slides in a row, in workspace units. */
export const STORE_SLIDE_GAP = 80

/** A store target id from the screenshots catalog, such as `ios-iphone-6.9`. */
export const storeTargetIdSchema = z
  .string()
  .max(80)
  .refine((id) => Boolean(getStoreTarget(id)), 'Use a store size from the catalog.')

const coordinate = z.number().finite().min(-1_000_000).max(1_000_000)

/** A store group placed on the plane. */
export const canvasStoreGroupSchema = z.object({
  group: storeGroupSchema,
  x: coordinate,
  y: coordinate,
  /** The device size the slides are laid out and previewed at. Export can add others. */
  targetId: storeTargetIdSchema.default(DEFAULT_TARGET_ID),
})
/** One of {@link canvasStoreGroupSchema}. */
export type CanvasStoreGroup = z.infer<typeof canvasStoreGroupSchema>

/** The pixel size each slide is drawn at for the group's target. */
export function storeSlideSize(item: Pick<CanvasStoreGroup, 'targetId'>) {
  return targetPixelSize(getStoreTargetOrDefault(item.targetId), 0, 'portrait')
}

/** Where each slide sits on the plane, left to right. */
export function storeSlideRects(item: CanvasStoreGroup): WorkspaceRect[] {
  const size = storeSlideSize(item)
  return item.group.document.slides.map((_, index) => ({
    x: item.x + index * (size.width + STORE_SLIDE_GAP),
    y: item.y,
    width: size.width,
    height: size.height,
  }))
}

/** The rectangle around all of a group's slides. */
export function storeGroupRect(item: CanvasStoreGroup): WorkspaceRect {
  const size = storeSlideSize(item)
  const count = Math.max(1, item.group.document.slides.length)
  return {
    x: item.x,
    y: item.y,
    width: count * size.width + (count - 1) * STORE_SLIDE_GAP,
    height: size.height,
  }
}

/** A store group placed at a point, at the default size. */
export function placeStoreGroup(group: StoreGroup, at: { x: number; y: number }): CanvasStoreGroup {
  return canvasStoreGroupSchema.parse({ group, x: Math.round(at.x), y: Math.round(at.y) })
}
