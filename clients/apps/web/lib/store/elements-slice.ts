import type { ImageState } from './index'
import { orderedLayerIds, moveLayer } from '@/lib/editor/layer-order'
import { z } from 'zod'
import { useDeviceUIStore } from './device-ui'
import type { CanvasElement } from '@/lib/editor/elements/schema'

/** Where a layer moves in the stacking order. */
export const layerOrderSchema = z.enum(['up', 'down', 'top', 'bottom'])
/** A stacking-order move. */
export type LayerOrder = z.infer<typeof layerOrderSchema>

/** Composition elements in the editor store. Order is z-order: last is on top. */
export interface ElementsSlice {
  elements: CanvasElement[]
  /** Session-only: never saved or undone. */
  selectedElementId: string | null
  addElement: (element: CanvasElement) => void
  /** Merge changes into an element; `props` merges too. */
  updateElement: (id: string, changes: ElementChanges) => void
  removeElement: (id: string) => void
  duplicateElement: (id: string) => string | null
  /** Move an element one step up or down, or to the top or bottom. */
  reorderElement: (id: string, direction: LayerOrder) => void
  setSelectedElementId: (id: string | null) => void
}

/** Changes to one element: any base field, and any of its own props. */
export type ElementChanges = Partial<Omit<CanvasElement, 'id' | 'type' | 'props'>> & {
  props?: Partial<CanvasElement['props']>
}

type SetState = (
  partial:
    | Partial<ElementsSlice & SelectionFields & { layerOrder: string[] }>
    | ((state: ElementsSlice) => Partial<ElementsSlice & SelectionFields & { layerOrder: string[] }>)
) => void

/** Selections an element selection replaces. */
type SelectionFields = {
  isMainImageSelected: boolean
  selectedAnnotationId: string | null
  selectedBlurId: string | null
  selectedOverlayId: string | null
  selectedTextId: string | null
}

function moved(elements: CanvasElement[], index: number, direction: LayerOrder) {
  const target =
    direction === 'top'
      ? elements.length - 1
      : direction === 'bottom'
        ? 0
        : direction === 'up'
          ? Math.min(elements.length - 1, index + 1)
          : Math.max(0, index - 1)
  const next = [...elements]
  const [element] = next.splice(index, 1)
  next.splice(target, 0, element!)
  return next
}

/** The elements slice, spread into the editor store. */
export function createElementsSlice(set: SetState, get: () => ElementsSlice): ElementsSlice {
  const select = (id: string) => {
    useDeviceUIStore.getState().setSelectedDeviceId(null)
    return {
      isMainImageSelected: false,
      selectedAnnotationId: null,
      selectedBlurId: null,
      selectedElementId: id,
      selectedOverlayId: null,
      selectedTextId: null,
    }
  }
  return {
    elements: [],
    selectedElementId: null,
    addElement: (element) =>
      set((state) => {
        let placed = element
        // Keep explicit placement, but cascade exact overlaps so each new element can be picked.
        for (let attempt = 0; attempt < 12 && state.elements.some((item) => Math.abs(item.x - placed.x) < 0.02 && Math.abs(item.y - placed.y) < 0.02); attempt++) {
          placed = { ...placed, x: Math.min(0.9, placed.x + 0.04), y: Math.min(0.9, placed.y + 0.04) }
        }
        return { layerOrder: [...orderedLayerIds(state as ImageState), element.id], elements: [...state.elements, placed], ...select(element.id) }
      }),
    updateElement: (id, changes) =>
      set((state) => ({
        elements: state.elements.map((element) =>
          element.id === id
            ? ({
                ...element,
                ...changes,
                props: { ...element.props, ...changes.props },
              } as CanvasElement)
            : element
        ),
      })),
    removeElement: (id) =>
      set((state) => ({
        elements: state.elements.filter((element) => element.id !== id),
        selectedElementId: state.selectedElementId === id ? null : state.selectedElementId,
      })),
    duplicateElement: (id) => {
      const source = get().elements.find((element) => element.id === id)
      if (!source) return null
      const copy = {
        ...structuredClone(source),
        id: `element-${crypto.randomUUID()}`,
        x: Math.min(1.4, source.x + 0.03),
        y: Math.min(1.4, source.y + 0.03),
      }
      set((state) => ({ layerOrder: [...orderedLayerIds(state as ImageState), copy.id], elements: [...state.elements, copy], ...select(copy.id) }))
      return copy.id
    },
    reorderElement: (id, direction) =>
      set((state) => {
        const index = state.elements.findIndex((element) => element.id === id)
        return index === -1 ? {} : { elements: moved(state.elements, index, direction), layerOrder: moveLayer(orderedLayerIds(state as ImageState), id, direction) }
      }),
    setSelectedElementId: (id) => set(id ? select(id) : { selectedElementId: null }),
  }
}
