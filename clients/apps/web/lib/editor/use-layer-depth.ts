import { useImageStore } from '@/lib/store'
import { orderedLayerIds, moveLayer } from './layer-order'

/** Depth shared by stage layers, including layers with their own transforms. */
export function useLayerDepth(id: string): number {
  return useImageStore((state) => 20 + orderedLayerIds(state).indexOf(id))
}

/** A single undoable reorder across text, screens, stickers, elements and drawings. */
export function reorderLayer(id: string, direction: 'up' | 'down' | 'top' | 'bottom') {
  useImageStore.setState((state) => ({ layerOrder: moveLayer(orderedLayerIds(state), id, direction) }))
}
