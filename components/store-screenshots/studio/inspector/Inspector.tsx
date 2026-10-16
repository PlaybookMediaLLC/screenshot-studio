'use client'

import * as React from 'react'
import type { SceneAnnotation, SceneCallout, SceneDevice, SceneText } from '@/lib/store-screenshots/engine/scene'
import { useActiveScene } from '../active-scene'
import { ownerLayers, useEditor } from '../editor-store'
import { BulkPanel } from './BulkPanel'
import { DevicePanel } from './DevicePanel'
import { AnnotationPanel, CalloutPanel, ImagePanel, MultiLayerPanel, PickingHint } from './ElementPanels'
import { SlidePanel } from './SlidePanel'
import { TextPanel } from './TextPanel'

/**
 * The contextual inspector: it shows exactly the controls for what is
 * selected. Several slides selected shows bulk editing; one layer shows that
 * layer; several layers show alignment; nothing selected shows the slide.
 * There is one inspector, docked beside the canvas, so it never covers the
 * slide being edited.
 */
export function Inspector(): React.JSX.Element {
  const selectedSlideCount = useEditor((state) => state.selectedSlideIds.length)
  const selection = useEditor((state) => state.selection)
  const picking = useEditor((state) => state.pickingCalloutId)
  const document = useEditor((state) => state.document)
  const { scene } = useActiveScene()

  let body: React.ReactNode
  if (picking) {
    body = <PickingHint />
  } else if (selectedSlideCount > 1) {
    body = <BulkPanel />
  } else if (!selection || selection.layerIds.length === 0) {
    body = <SlidePanel />
  } else if (selection.layerIds.length > 1) {
    body = <MultiLayerPanel owner={selection.owner} layerIds={selection.layerIds} />
  } else {
    const layer = ownerLayers(document, selection.owner).find((item) => item.id === selection.layerIds[0])
    const node = scene?.nodes.find((item) => item.layerId === layer?.id)
    if (!layer) body = <SlidePanel />
    else if (layer.type === 'text') body = <TextPanel owner={selection.owner} layer={layer} node={node as SceneText | undefined} />
    else if (layer.type === 'device') body = <DevicePanel owner={selection.owner} layer={layer} node={node as SceneDevice | undefined} />
    else if (layer.type === 'annotation') body = <AnnotationPanel owner={selection.owner} layer={layer} node={node as SceneAnnotation | undefined} />
    else if (layer.type === 'callout') body = <CalloutPanel owner={selection.owner} layer={layer} node={node as SceneCallout | undefined} />
    else body = <ImagePanel owner={selection.owner} layer={layer} node={node} />
  }

  return (
    <aside aria-label="Inspector" data-store-inspector="" className="flex h-full w-[300px] shrink-0 flex-col overflow-hidden border-l border-foreground/10 bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{body}</div>
    </aside>
  )
}
