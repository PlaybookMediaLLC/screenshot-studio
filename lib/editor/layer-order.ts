import type { ImageState } from '@/lib/store'

/** Stable bottom-to-top order, migrating older documents from their grouped depths. */
export function orderedLayerIds(state: Pick<ImageState, 'layerOrder' | 'mockups' | 'imageOverlays' | 'textOverlays' | 'elements' | 'annotations' | 'blurRegions'>): string[] {
  const defaults = [
    ...state.imageOverlays.filter((item) => item.layer === 'back').map((item) => item.id),
    ...state.textOverlays.filter((item) => (item.zIndex ?? 210) < 20).map((item) => item.id),
    '__main__',
    ...state.mockups.map((item) => item.id),
    ...state.imageOverlays.filter((item) => item.layer !== 'back').map((item) => item.id),
    ...state.elements.map((item) => item.id),
    ...state.textOverlays.filter((item) => (item.zIndex ?? 210) >= 20).map((item) => item.id),
    ...state.blurRegions.map((item) => item.id),
    ...state.annotations.map((item) => item.id),
  ]
  const live = new Set(defaults)
  return [...new Set([...(state.layerOrder ?? []).filter((id) => live.has(id)), ...defaults])]
}

/** Move one layer through the shared stack, preserving every other layer's order. */
export function moveLayer(order: readonly string[], id: string, direction: 'up' | 'down' | 'top' | 'bottom'): string[] {
  const next = [...order]
  const index = next.indexOf(id)
  if (index < 0) return next
  const target = direction === 'top' ? next.length - 1 : direction === 'bottom' ? 0 : Math.max(0, Math.min(next.length - 1, index + (direction === 'up' ? 1 : -1)))
  next.splice(index, 1)
  next.splice(target, 0, id)
  return next
}
