'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  Copy01Icon,
  CropIcon,
  Delete02Icon,
  ImageUpload01Icon,
  LayerBringToFrontIcon,
  LayerSendToBackIcon,
  ArrowDown01Icon,
  ArrowUp01Icon,
} from 'hugeicons-react'
import { SectionWrapper } from '@/components/editor/sections/SectionWrapper'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Slider } from '@/components/ui/slider'
import { ALLOWED_IMAGE_TYPES } from '@/lib/constants'
import { MAX_DEVICE_MOCKUPS } from '@/lib/constants/mockups'
import { clearEditorSelection, selectScreen } from '@/lib/editor/selection'
import { replaceScreenImage } from '@/lib/frames/commands'
import { contentLabel, frameLabel } from '@/lib/frames/labels'
import { useImageStore } from '@/lib/store'
import { useDeviceUIStore } from '@/lib/store/device-ui'
import { useEditorPanels } from '@/lib/store/editor-panels'
import type { DeviceImageFit } from '@/types/mockup'
import { CodeOptions } from './CodeOptions'
import { Input } from '@/components/ui/input'

const iconButton =
  'flex h-8 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-35 max-[768px]:h-11'

/**
 * The selected composition screen: its content (image or code), crop,
 * placement, and stacking order. Its frame is edited in the Frame panel.
 */
export function ScreenInspector({ id }: { id: string }) {
  const screen = useImageStore((state) => state.mockups.find((mockup) => mockup.id === id))
  const count = useImageStore((state) => state.mockups.length)
  const updateMockup = useImageStore((state) => state.updateMockup)
  const reorderMockup = useImageStore((state) => state.reorderMockup)
  const duplicateMockup = useImageStore((state) => state.duplicateMockup)
  const removeMockup = useImageStore((state) => state.removeMockup)
  const cropping = useDeviceUIStore((state) => state.editingScreenDeviceId === id)
  const setCropping = useDeviceUIStore((state) => state.setEditingScreenDeviceId)
  const fileInput = React.useRef<HTMLInputElement>(null)
  if (!screen) return null
  const { code } = screen.screen

  return (
    <SectionWrapper title="Screen" defaultOpen>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs font-medium text-foreground">
            {contentLabel(screen)}
          </p>
          <Button variant="custom" size={null}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => useEditorPanels.getState().showTab('frame')}
            type="button"
          >
            {frameLabel(screen)} · Change
          </Button>
        </div>

        {code ? (
          <CodeOptions code={code} id={screen.id} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                className="text-xs max-[768px]:min-h-11"
                onClick={() => fileInput.current?.click()}
                size="sm"
                variant="outline"
              >
                <ImageUpload01Icon size={13} /> Replace
              </Button>
              <Button
                aria-pressed={cropping}
                className="text-xs max-[768px]:min-h-11"
                onClick={() => setCropping(cropping ? null : screen.id)}
                size="sm"
                variant="outline"
              >
                <CropIcon size={13} /> {cropping ? 'Done' : 'Crop'}
              </Button>
            </div>
            <Input
              accept={ALLOWED_IMAGE_TYPES.join(',')}
              aria-label="Replace screen image"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                replaceScreenImage(screen.id, file).catch((error: unknown) =>
                  toast.error(
                    error instanceof Error ? error.message : "That image couldn't be used."
                  )
                )
              }}
              ref={fileInput}
              type="file"
            />
            <SegmentedControl
              ariaLabel="Screen fit"
              onChange={(fit) =>
                updateMockup(screen.id, {
                  screen: { ...screen.screen, fit: fit as DeviceImageFit },
                })
              }
              options={[
                { id: 'cover', label: 'Fill' },
                { id: 'contain', label: 'Fit' },
              ]}
              size="sm"
              value={screen.screen.fit}
            />
            <Slider
              label="Zoom"
              max={3}
              min={1}
              onValueChange={([scale]) =>
                updateMockup(screen.id, { screen: { ...screen.screen, scale } })
              }
              step={0.05}
              value={[screen.screen.scale]}
              valueDisplay={`${Math.round(screen.screen.scale * 100)}%`}
            />
            {cropping ? (
              <p className="text-[11px] leading-snug text-muted-foreground">
                Drag the screenshot, or use the arrow keys, to choose what shows. Esc when done.
              </p>
            ) : null}
          </>
        )}

        <Slider
          label="Size"
          max={1}
          min={0.05}
          onValueChange={([size]) => updateMockup(screen.id, { size })}
          step={0.01}
          value={[screen.size]}
          valueDisplay={`${Math.round(screen.size * 100)}%`}
        />
        <Slider
          label="Rotation"
          max={180}
          min={-180}
          onValueChange={([rotation]) => updateMockup(screen.id, { rotation })}
          step={1}
          value={[screen.rotation]}
          valueDisplay={`${screen.rotation}°`}
        />
        <Slider
          label="Opacity"
          max={1}
          min={0}
          onValueChange={([opacity]) => updateMockup(screen.id, { opacity })}
          step={0.01}
          value={[screen.opacity]}
          valueDisplay={`${Math.round(screen.opacity * 100)}%`}
        />

        <div className="grid grid-cols-6 gap-1" role="group" aria-label="Screen order and actions">
          <Button variant="custom" size={null}
            aria-label="Send to back"
            className={iconButton}
            onClick={() => reorderMockup(screen.id, 'bottom')}
            title="Send to back"
            type="button"
          >
            <LayerSendToBackIcon size={14} />
          </Button>
          <Button variant="custom" size={null}
            aria-label="Send backward"
            className={iconButton}
            onClick={() => reorderMockup(screen.id, 'down')}
            title="Send backward"
            type="button"
          >
            <ArrowDown01Icon size={14} />
          </Button>
          <Button variant="custom" size={null}
            aria-label="Bring forward"
            className={iconButton}
            onClick={() => reorderMockup(screen.id, 'up')}
            title="Bring forward"
            type="button"
          >
            <ArrowUp01Icon size={14} />
          </Button>
          <Button variant="custom" size={null}
            aria-label="Bring to front"
            className={iconButton}
            onClick={() => reorderMockup(screen.id, 'top')}
            title="Bring to front"
            type="button"
          >
            <LayerBringToFrontIcon size={14} />
          </Button>
          <Button variant="custom" size={null}
            aria-label="Duplicate screen"
            className={iconButton}
            disabled={count >= MAX_DEVICE_MOCKUPS}
            onClick={() => {
              const copy = duplicateMockup(screen.id)
              if (copy) selectScreen(copy)
            }}
            title="Duplicate"
            type="button"
          >
            <Copy01Icon size={14} />
          </Button>
          <Button variant="custom" size={null}
            aria-label="Delete screen"
            className="flex h-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive max-[768px]:h-11"
            onClick={() => {
              removeMockup(screen.id)
              clearEditorSelection()
            }}
            title="Delete"
            type="button"
          >
            <Delete02Icon size={14} />
          </Button>
        </div>
      </div>
    </SectionWrapper>
  )
}
