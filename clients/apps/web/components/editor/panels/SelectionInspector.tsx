'use client'

import * as React from 'react'
import { XIcon as Cancel01Icon } from '@phosphor-icons/react/dist/ssr/X'
import { TrashIcon as Delete02Icon } from '@phosphor-icons/react/dist/ssr/Trash'
import { ScreenInspector } from '@/components/frames/panels/ScreenInspector'
import { TextProperties } from '@/components/text-overlay/text-overlay-controls'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Slider } from '@/components/ui/slider'
import { clearEditorSelection, type SelectionKind, useEditorSelection } from '@/lib/editor/selection'
import { useImageStore } from '@/lib/store'
import {
  AdjustSection,
  AnnotateSection,
  BorderSection,
  ImagePositionSection,
  OverlayProperties,
  SectionWrapper,
  ShadowSection,
} from '../sections'
import { CanvasSection } from './CanvasSection'
import { ElementInspector } from '../inspector/ElementInspector'
import { Button } from '@/components/ui/button'

const KIND_LABELS: Record<SelectionKind, string> = {
  annotation: 'Markup',
  device: 'Screen',
  element: 'Element',
  image: 'Screenshot',
  redaction: 'Redaction',
  sticker: 'Sticker',
  text: 'Text',
}

/** The selected redaction region's method and strength. */
function RedactionProperties({ id }: { id: string }) {
  const region = useImageStore((state) => state.blurRegions.find((item) => item.id === id))
  const updateBlurRegion = useImageStore((state) => state.updateBlurRegion)
  const removeBlurRegion = useImageStore((state) => state.removeBlurRegion)
  if (!region) return null
  return (
    <SectionWrapper title="Redaction" defaultOpen>
      <div className="space-y-3">
        <SegmentedControl
          onChange={(style) => updateBlurRegion(id, { style: style as 'blur' | 'mosaic' })}
          options={[
            { id: 'mosaic', label: 'Pixelate' },
            { id: 'blur', label: 'Blur' },
          ]}
          value={region.style ?? 'blur'}
        />
        <Slider
          label="Strength"
          max={60}
          min={1}
          onValueChange={(value) => updateBlurRegion(id, { blurAmount: value[0] })}
          step={1}
          value={[region.blurAmount]}
          valueDisplay={`${region.blurAmount}`}
        />
        <Button variant="custom" size={null}
          className="flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-destructive hover:bg-destructive/10"
          onClick={() => removeBlurRegion(id)}
          type="button"
        >
          <Delete02Icon size={13} /> Remove redaction
        </Button>
      </div>
    </SectionWrapper>
  )
}

/** The selected sticker's properties. */
function StickerProperties({ id }: { id: string }) {
  const overlay = useImageStore((state) => state.imageOverlays.find((item) => item.id === id))
  const updateImageOverlay = useImageStore((state) => state.updateImageOverlay)
  const removeImageOverlay = useImageStore((state) => state.removeImageOverlay)
  if (!overlay) return null
  return (
    <SectionWrapper title="Sticker" defaultOpen>
      <OverlayProperties
        onRemove={() => removeImageOverlay(id)}
        onUpdate={(updates) => updateImageOverlay(id, updates)}
        overlay={overlay}
      />
    </SectionWrapper>
  )
}

/** The screenshot's own properties, shown when it or nothing is selected. */
function ScreenshotProperties() {
  const hasImage = useImageStore((state) => Boolean(state.uploadedImageUrl))
  return (
    <>
      {hasImage ? (
        <>
          <ImagePositionSection />
          <BorderSection />
          <ShadowSection />
          <AdjustSection />
        </>
      ) : (
        <p className="rounded-md border border-foreground/10 bg-foreground/[0.03] p-3 text-xs text-muted-foreground">
          Add a screenshot to edit it here. Select text, a sticker, or a device on the canvas to edit it instead.
        </p>
      )}
      <CanvasSection />
    </>
  )
}

/**
 * The Edit tab: properties of whatever is selected, on the canvas or in the
 * layer list. With nothing selected it shows the screenshot and the canvas.
 */
export function SelectionInspector() {
  const selection = useEditorSelection()
  const kind = selection?.kind ?? 'image'
  const id = selection?.id ?? null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 rounded-md border border-foreground/10 bg-foreground/[0.03] px-2.5 py-1.5">
        <p className="min-w-0 truncate text-xs">
          <span className="text-muted-foreground">Editing </span>
          <span className="font-medium text-foreground">{KIND_LABELS[kind]}</span>
        </p>
        {selection ? (
          <Button variant="custom" size={null}
            aria-label="Clear selection"
            className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
            onClick={clearEditorSelection}
            type="button"
          >
            <Cancel01Icon size={13} />
          </Button>
        ) : null}
      </div>
      {kind === 'element' && id ? (
        <ElementInspector id={id} />
      ) : kind === 'text' ? (
        <SectionWrapper title="Text" defaultOpen>
          <TextProperties />
        </SectionWrapper>
      ) : kind === 'sticker' && id ? (
        <StickerProperties id={id} />
      ) : kind === 'device' && id ? (
        <ScreenInspector id={id} />
      ) : kind === 'annotation' ? (
        <AnnotateSection />
      ) : kind === 'redaction' && id ? (
        <RedactionProperties id={id} />
      ) : (
        <ScreenshotProperties />
      )}
    </div>
  )
}
