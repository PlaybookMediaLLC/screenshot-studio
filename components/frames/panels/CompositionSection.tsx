'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { CodeIcon, ImageAdd01Icon, RotateClockwiseIcon } from 'hugeicons-react'
import { DocumentPreview } from '@/components/design/DocumentPreview'
import { SectionWrapper } from '@/components/editor/sections/SectionWrapper'
import { Button } from '@/components/ui/button'
import { aspectRatios } from '@/lib/constants/aspect-ratios'
import { ALLOWED_IMAGE_TYPES } from '@/lib/constants'
import { DEVICE_LAYOUTS } from '@/lib/constants/mockups'
import { withCompositionLayout } from '@/lib/frames/arrange'
import {
  addCodeScreen,
  addScreenshots,
  applyCompositionLayout,
  isScreenScene,
  MAX_SCREENS,
} from '@/lib/frames/commands'
import { COMPOSITION_LAYOUTS, compositionLayoutSchema } from '@/lib/frames/layouts'
import { useEditorDocument } from '@/lib/design/use-editor-document'
import { useImageStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

/**
 * Several screenshots in one composition: add screenshots or code, and lay
 * them out. Each layout's thumbnail is the design itself with that layout
 * applied, drawn by the editor's stage, so it shows every screen's frame.
 */
export function CompositionSection() {
  const fileInput = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)
  const scene = useImageStore(isScreenScene)
  const count = useImageStore((state) =>
    isScreenScene(state) ? state.mockups.length : state.uploadedImageUrl ? 1 : 0
  )
  const activeLayout = useImageStore((state) => state.activeDeviceLayoutId)
  const applyDeviceLayout = useImageStore((state) => state.applyDeviceLayout)
  const selectedAspectRatio = useImageStore((state) => state.selectedAspectRatio)
  const customDimensions = useImageStore((state) => state.customDimensions)
  const editorDocument = useEditorDocument()
  const ratio = aspectRatios.find((item) => item.id === selectedAspectRatio)
  const cssAspect =
    selectedAspectRatio === 'custom' && customDimensions
      ? `${customDimensions.width} / ${customDimensions.height}`
      : ratio
        ? `${ratio.width} / ${ratio.height}`
        : '4 / 3'

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const onFiles = (files: File[]) =>
    run(async () => {
      const result = await addScreenshots(files)
      for (const { name, reason } of result.rejected) toast.error(`${name}: ${reason}`)
    })

  return (
    <SectionWrapper title="Composition" defaultOpen>
      <div className="space-y-3">
        <p className="text-[11px] leading-snug text-muted-foreground">
          {scene
            ? `${count} screens in this composition (maximum ${MAX_SCREENS}). Select one on the canvas to frame it on its own.`
            : 'Show several screenshots, or code, side by side in one design.'}
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            className="text-xs max-[768px]:min-h-11"
            disabled={busy || count >= MAX_SCREENS}
            onClick={() => fileInput.current?.click()}
            size="sm"
            variant="outline"
          >
            <ImageAdd01Icon size={14} /> Add screenshots
          </Button>
          <Button
            className="text-xs max-[768px]:min-h-11"
            disabled={busy || count >= MAX_SCREENS}
            onClick={() => run(async () => void (await addCodeScreen()))}
            size="sm"
            variant="outline"
          >
            <CodeIcon size={14} /> Add code
          </Button>
        </div>
        <Input
          accept={ALLOWED_IMAGE_TYPES.join(',')}
          aria-label="Add screenshots"
          className="hidden"
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            if (files.length > 0) void onFiles(files)
          }}
          ref={fileInput}
          type="file"
        />

        {scene ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">Layout</span>
              {activeLayout ? (
                <Button variant="custom" size={null}
                  className="flex min-h-6 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    const composition = compositionLayoutSchema.safeParse(activeLayout)
                    if (composition.success) applyCompositionLayout(composition.data)
                    else applyDeviceLayout(activeLayout)
                  }}
                  type="button"
                >
                  <RotateClockwiseIcon size={12} /> Reset
                </Button>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Composition layouts">
              {compositionLayoutSchema.options.map((layout) => (
                <Button variant="custom" size={null}
                  aria-label={`${COMPOSITION_LAYOUTS[layout].name} layout`}
                  aria-pressed={activeLayout === layout}
                  className="group flex min-w-0 flex-col gap-1 text-left"
                  data-layout-id={layout}
                  key={layout}
                  onClick={() => applyCompositionLayout(layout)}
                  title={COMPOSITION_LAYOUTS[layout].description}
                  type="button"
                >
                  <span
                    className={cn(
                      'block w-full overflow-hidden rounded-md border bg-foreground/[0.03]',
                      activeLayout === layout
                        ? 'border-primary ring-1 ring-foreground/20'
                        : 'border-foreground/10 group-hover:border-foreground/20'
                    )}
                    style={{ aspectRatio: cssAspect }}
                  >
                    <DocumentPreview
                      alt={`${COMPOSITION_LAYOUTS[layout].name} layout preview`}
                      document={
                        editorDocument ? withCompositionLayout(editorDocument, layout) : null
                      }
                    />
                  </span>
                  <span className="px-0.5 text-[10px] leading-tight text-muted-foreground">
                    {COMPOSITION_LAYOUTS[layout].name}
                  </span>
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Device layouts">
              {DEVICE_LAYOUTS.map((layout) => (
                <Button variant="custom" size={null}
                  aria-pressed={activeLayout === layout.id}
                  className={cn(
                    'min-h-8 rounded-md border px-2 py-1.5 text-left text-xs leading-tight transition-colors max-[768px]:min-h-11 disabled:cursor-not-allowed disabled:opacity-35',
                    activeLayout === layout.id
                      ? 'border-foreground/25 bg-foreground/[0.07] font-medium text-foreground'
                      : 'border-foreground/10 text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
                  )}
                  disabled={count > layout.slots.length}
                  key={layout.id}
                  onClick={() => applyDeviceLayout(layout.id)}
                  title={layout.description}
                  type="button"
                >
                  {layout.name}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </SectionWrapper>
  )
}
