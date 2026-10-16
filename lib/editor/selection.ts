'use client'

import { z } from 'zod'
import { useImageStore } from '@/lib/store'
import { useDeviceUIStore } from '@/lib/store/device-ui'

/** The kinds of thing the editor can have selected. */
export const selectionKindSchema = z.enum(['image', 'text', 'sticker', 'element', 'annotation', 'redaction', 'device'])
/** A selectable layer kind. */
export type SelectionKind = z.infer<typeof selectionKindSchema>

/** What is selected on the canvas, or null. At most one thing is selected. */
export type EditorSelection = { id: string | null; kind: SelectionKind } | null

/** The current selection, from wherever it was made: canvas, layer list, or panel. */
export function useEditorSelection(): EditorSelection {
  const overlay = useImageStore((state) => state.selectedOverlayId)
  const text = useImageStore((state) => state.selectedTextId)
  const annotation = useImageStore((state) => state.selectedAnnotationId)
  const redaction = useImageStore((state) => state.selectedBlurId)
  const image = useImageStore((state) => state.isMainImageSelected)
  const device = useDeviceUIStore((state) => state.selectedDeviceId)
  const element = useImageStore((state) => state.selectedElementId)
  if (element) return { id: element, kind: 'element' }
  if (text) return { id: text, kind: 'text' }
  if (overlay) return { id: overlay, kind: 'sticker' }
  if (annotation) return { id: annotation, kind: 'annotation' }
  if (redaction) return { id: redaction, kind: 'redaction' }
  if (device) return { id: device, kind: 'device' }
  if (image) return { id: null, kind: 'image' }
  return null
}

/** Select one composition screen (a screenshot, code, or device), and nothing else. */
export function selectScreen(id: string) {
  clearEditorSelection()
  useDeviceUIStore.getState().setSelectedDeviceId(id)
}

/** Clear every selection. */
export function clearEditorSelection() {
  const state = useImageStore.getState()
  state.setSelectedOverlayId(null)
  state.setSelectedTextId(null)
  state.setSelectedAnnotationId(null)
  state.setSelectedBlurId(null)
  state.setSelectedElementId(null)
  state.setIsMainImageSelected(false)
  useDeviceUIStore.getState().setSelectedDeviceId(null)
}
