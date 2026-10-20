'use client'

import { useMemo } from 'react'
import { toast } from 'sonner'
import {
  createComponent,
  componentInstanceSchema,
  mainLayerId,
  type CanvasComponent,
} from '@/lib/canvas/components'
import { artboardSize, type Artboard, type WorkspaceRect } from '@/lib/canvas/document'
import {
  duplicateLayers,
  groupLayers,
  groupOf,
  LAYER_ATTRIBUTES,
  layerKey,
  layerRefs,
  offsetLayers,
  removeLayers,
  setLayersVisible,
  translateLayers,
  ungroupLayers,
  type LayerRef,
} from '@/lib/canvas/layers'
import {
  alignRects,
  distributeRects,
  type AlignMode,
  type DistributeAxis,
} from '@/lib/canvas/layout'
import type { CanvasSession } from '@/lib/canvas/session'
import { useCanvasUi } from '@/lib/canvas/ui-store'
import { designDocumentSchema, type DesignDocument } from '@/lib/design/document'
import { useImageStore } from '@/lib/store'
import { exportDesignDocument } from '@/lib/design/export'

/** The open artboard's stage element, drawn by the mounted editor. */
export function activeStage(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-canvas-editor] #image-render-card')
}

/** The stage element drawing one layer, if it is drawn. */
export function layerElement(stage: ParentNode, ref: LayerRef): Element | null {
  return stage.querySelector(`[${LAYER_ATTRIBUTES[ref.kind]}="${CSS.escape(ref.id)}"]`)
}

/** Where each layer is drawn, in fractions of the stage; layers that are not drawn are left out. */
export function measureLayers(refs: readonly LayerRef[]): Map<string, WorkspaceRect> {
  const stage = activeStage()
  const result = new Map<string, WorkspaceRect>()
  if (!stage) return result
  const bounds = stage.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return result
  for (const ref of refs) {
    const rect = layerElement(stage, ref)?.getBoundingClientRect()
    if (!rect || (!rect.width && !rect.height)) continue
    result.set(layerKey(ref), {
      x: (rect.left - bounds.left) / bounds.width,
      y: (rect.top - bounds.top) / bounds.height,
      width: rect.width / bounds.width,
      height: rect.height / bounds.height,
    })
  }
  return result
}

/** The instance a set of layers is exactly, if it is one. */
export function instanceOfSelection(artboard: Artboard, refs: readonly LayerRef[]) {
  if (!refs.length) return null
  const instanceId = refs[0]!.id.split('.')[0]!
  const instance = artboard.instances.find((item) => item.id === instanceId)
  if (!instance) return null
  return refs.every((ref) => mainLayerId(instance.id, ref.id) !== null) ? instance : null
}

const shortId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10)

const textLayerSchema = designDocumentSchema.shape.texts.unwrap().element

/** Dark ink on a light solid background, white otherwise. */
function inkFor(document: DesignDocument): string {
  const value = document.background?.type === 'solid' ? String(document.background.value) : ''
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1]
  if (!hex) return '#ffffff'
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.55 ? '#141a17' : '#ffffff'
}

/** Layer actions on the open artboard. Each is one undo step and keeps the editor mounted. */
export function useLayerActions(
  session: CanvasSession,
  flush: () => void,
  sync: () => Promise<void>
) {
  return useMemo(() => {
    const active = (): Artboard | null => {
      const id = useCanvasUi.getState().activeId
      return session.snapshot().document.artboards.find((item) => item.id === id) ?? null
    }
    const selected = () => useCanvasUi.getState().layers
    const run = async (
      change: (
        artboard: Artboard
      ) => { document: DesignDocument; groups?: Artboard['groups'] } | null
    ) => {
      try {
        flush()
        const artboard = active()
        if (!artboard) return
        const next = change(artboard)
        if (!next) return
        session.command({
          type: 'set-artboard-layers',
          id: artboard.id,
          document: next.document,
          groups: next.groups ?? artboard.groups,
        })
        await sync()
      } catch (failure) {
        toast.error(
          failure instanceof Error ? failure.message : 'That layer change could not be made.'
        )
      }
    }
    const arrange = (
      positions: (
        items: { id: string; rect: WorkspaceRect }[]
      ) => { id: string; x: number; y: number }[]
    ) =>
      run((artboard) => {
        const refs = selected()
        const size = artboardSize(artboard)
        const rects = measureLayers(refs)
        const items = refs.flatMap((ref) => {
          const rect = rects.get(layerKey(ref))
          return rect
            ? [
                {
                  id: layerKey(ref),
                  ref,
                  rect: {
                    x: rect.x * size.width,
                    y: rect.y * size.height,
                    width: rect.width * size.width,
                    height: rect.height * size.height,
                  },
                },
              ]
            : []
        })
        if (!items.length) return null
        const targets = positions(items)
        const offsets = targets.flatMap((target) => {
          const item = items.find((entry) => entry.id === target.id)
          return item
            ? [
                {
                  ref: item.ref,
                  dx: (target.x - item.rect.x) / size.width,
                  dy: (target.y - item.rect.y) / size.height,
                },
              ]
            : []
        })
        return { document: offsetLayers(artboard.document, offsets) }
      })
    return {
      /** Move the selection by fractions of the artboard. */
      move: (refs: readonly LayerRef[], dx: number, dy: number) =>
        run((artboard) => ({ document: translateLayers(artboard.document, refs, dx, dy) })),
      /** Nudge the selection by artboard pixels. */
      nudge: (x: number, y: number) =>
        run((artboard) => {
          const size = artboardSize(artboard)
          return {
            document: translateLayers(
              artboard.document,
              selected(),
              x / size.width,
              y / size.height
            ),
          }
        }),
      /** Line the selection up; one layer lines up with the artboard. */
      align: (mode: AlignMode) =>
        arrange((items) => {
          if (items.length > 1) return alignRects(items, mode)
          const artboard = active()!
          const size = artboardSize(artboard)
          const frame = {
            id: '__artboard',
            rect: { x: 0, y: 0, width: size.width, height: size.height },
          }
          return alignRects([frame, ...items], mode).filter((position) => position.id !== frame.id)
        }),
      distribute: (axis: DistributeAxis) => arrange((items) => distributeRects(items, axis)),
      remove: () =>
        run((artboard) => {
          const refs = selected()
          useCanvasUi.getState().selectLayers([])
          return { document: removeLayers(artboard.document, refs) }
        }),
      duplicate: () =>
        run((artboard) => {
          const { document, copies } = duplicateLayers(artboard.document, selected(), () =>
            crypto.randomUUID()
          )
          useCanvasUi.getState().selectLayers(copies)
          return { document }
        }),
      setVisible: (visible: boolean) =>
        run((artboard) => ({ document: setLayersVisible(artboard.document, selected(), visible) })),
      group: () =>
        run((artboard) => {
          const refs = selected()
          const id = crypto.randomUUID()
          const groups = groupLayers(artboard.groups, refs, {
            id,
            name: `Group ${artboard.groups.length + 1}`,
          })
          return { document: artboard.document, groups }
        }),
      ungroup: () =>
        run((artboard) => {
          const group = selected()[0] && groupOf(artboard.groups, selected()[0]!)
          if (!group) return null
          return { document: artboard.document, groups: ungroupLayers(artboard.groups, group.id) }
        }),
      /**
       * Store the ids the editor shows for layers an older document left
       * without one, so a selection made on the stage names stored layers.
       */
      ensureIds: () =>
        run((artboard) => {
          const stored = artboard.document
          const missing = [
            ...stored.texts,
            ...stored.overlays,
            ...stored.annotations,
            ...(stored.devices?.mockups ?? []),
          ].some((layer) => !layer.id)
          if (!missing) return null
          const live = exportDesignDocument({ keepLocalSources: true })
          const next = structuredClone(stored)
          const adopt = (layers: { id?: string }[], shown: { id?: string }[]) =>
            layers.forEach((layer, index) => {
              layer.id ??= shown[index]?.id ?? crypto.randomUUID()
            })
          adopt(next.texts, live.texts)
          adopt(next.overlays, live.overlays)
          adopt(next.annotations, live.annotations)
          adopt(next.devices?.mockups ?? [], live.devices?.mockups ?? [])
          return { document: next }
        }),
      /** Add a text layer at a point (artboard fractions) and return its id, to type into on the stage. */
      addText: async (at: { x: number; y: number }): Promise<string | null> => {
        const id = crypto.randomUUID()
        await run((artboard) => {
          if (artboard.document.texts.length >= 20)
            throw new Error('An artboard holds at most 20 text layers.')
          const document = structuredClone(artboard.document)
          document.texts.push(
            textLayerSchema.parse({
              id,
              text: 'Text',
              color: inkFor(document),
              fontFamily: 'inter',
              fontWeight: 'bold',
              fontSize: 0.04,
              align: 'center',
              fit: 'wrap',
              maxWidth: 0.6,
              position: { x: at.x * 100, y: at.y * 100 },
            })
          )
          return { document }
        })
        return active()?.document.texts.some((text) => text.id === id) ? id : null
      },
      /** Store text typed on the stage. Emptied text deletes its layer. */
      writeText: async (id: string, text: string) => {
        const store = useImageStore.getState()
        const value = text.slice(0, 300)
        if (value.trim()) store.updateTextOverlay(id, { text: value })
        else store.removeTextOverlay(id)
        try {
          flush()
        } catch (failure) {
          toast.error(failure instanceof Error ? failure.message : 'That text could not be kept.')
        }
      },
      /** Make a component from the selection; the selection becomes its first instance. */
      makeComponent: async (name: string) => {
        try {
          flush()
          const artboard = active()
          const refs = selected()
          if (!artboard || !refs.length) return
          const size = artboardSize(artboard)
          const rects = [...measureLayers(refs).values()]
          if (!rects.length) throw new Error('Select layers drawn on the artboard.')
          const left = Math.min(...rects.map((rect) => rect.x)) * size.width
          const top = Math.min(...rects.map((rect) => rect.y)) * size.height
          const right = Math.max(...rects.map((rect) => rect.x + rect.width)) * size.width
          const bottom = Math.max(...rects.map((rect) => rect.y + rect.height)) * size.height
          const instanceId = shortId()
          const made = createComponent(artboard.document, refs, {
            componentId: crypto.randomUUID(),
            instanceId,
            name,
            frame: {
              x: left,
              y: top,
              width: Math.max(1, right - left),
              height: Math.max(1, bottom - top),
            },
            newId: shortId,
          })
          session.command({
            type: 'add-component',
            component: made.component,
            artboardId: artboard.id,
            instance: made.instance,
            document: made.document,
          })
          useCanvasUi
            .getState()
            .selectLayers(
              layerRefs(made.document).filter((ref) => mainLayerId(instanceId, ref.id) !== null)
            )
          await sync()
          toast.success(`${name} is a component. Insert it from the Insert panel.`)
        } catch (failure) {
          toast.error(
            failure instanceof Error ? failure.message : 'The component could not be made.'
          )
        }
      },
      /** Place a component in the open artboard, centred. */
      insertComponent: async (component: CanvasComponent) => {
        try {
          flush()
          const artboard = active()
          if (!artboard) return
          const size = artboardSize(artboard)
          const scale = Math.min(
            1,
            (size.width * 0.9) / component.frame.width,
            (size.height * 0.9) / component.frame.height
          )
          session.command({
            type: 'insert-instance',
            artboardId: artboard.id,
            instance: componentInstanceSchema.parse({
              id: shortId(),
              componentId: component.id,
              version: component.version,
              x: (size.width - component.frame.width * scale) / 2,
              y: (size.height - component.frame.height * scale) / 2,
              scale,
            }),
          })
          await sync()
        } catch (failure) {
          toast.error(
            failure instanceof Error ? failure.message : 'The component could not be placed.'
          )
        }
      },
      /** Push an instance's changes to its main component, reset it, or detach it. */
      instance: async (
        type: 'update-component' | 'reset-instance' | 'detach-instance',
        instanceId: string
      ) => {
        try {
          flush()
          const artboard = active()
          if (!artboard) return
          session.command({ type, artboardId: artboard.id, instanceId })
          await sync()
        } catch (failure) {
          toast.error(
            failure instanceof Error ? failure.message : 'The component could not be updated.'
          )
        }
      },
    }
  }, [session, flush, sync])
}

/** One of the actions {@link useLayerActions} returns. */
export type LayerActions = ReturnType<typeof useLayerActions>
