'use client'

import * as React from 'react'
import { ChoiceField } from '@/components/editor/inspector/fields'
import { DeviceShell } from '@/components/mockups/DeviceShell'
import { StoreScreenshotsFeatureCard } from '@/components/store-screenshots/StoreScreenshotsFeatureCard'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { getMockupDefinition, getMockupsByFamily } from '@/lib/constants/mockups'
import { createDeviceScreen } from '@/lib/device-mockups/layouts'
import { deviceArtColor } from '@/lib/frames/devices'
import { deviceGeometry } from '@/lib/frames/geometry'
import { type DeviceOrientation, deviceOrientationSchema } from '@/lib/frames/schema'
import { useImageStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { DeviceFamily } from '@/types/mockup'
import { changeDevice, type FrameTarget } from './frame-target'
import { Button } from '@/components/ui/button'

/**
 * Device choice for the Frame panel: every device by family, and for drawn
 * devices their colors and orientation. Choosing a device keeps the screen's
 * image and crop.
 */

const FAMILIES: { id: DeviceFamily; label: string }[] = [
  { id: 'phone', label: 'Phone' },
  { id: 'tablet', label: 'Tablet' },
  { id: 'laptop', label: 'Laptop' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'watch', label: 'Watch' },
  { id: 'spatial', label: 'Vision' },
]

const ORIENTATION_LABELS: Record<DeviceOrientation, string> = {
  landscape: 'Landscape',
  portrait: 'Portrait',
}

/** Device, color, and orientation for the Frame panel's target. */
export function DeviceOptions({ target }: { target: FrameTarget }) {
  const uploadedImageUrl = useImageStore((state) => state.uploadedImageUrl)
  const imageName = useImageStore((state) => state.imageName)
  const first = target.screens[0]
  const onDevice =
    target.choice === 'device' && first && (first.frame?.kind ?? 'device') === 'device'
  const current = onDevice ? getMockupDefinition(first.definitionId) : undefined
  const [family, setFamily] = React.useState<DeviceFamily>(current?.family ?? 'phone')
  const preview = first?.screen.src
    ? first.screen
    : createDeviceScreen(first?.screen.src ?? uploadedImageUrl, imageName)
  const art = current?.art

  return (
    <div className="space-y-4">
      <SegmentedControl
        ariaLabel="Device family"
        onChange={(value) => setFamily(value as DeviceFamily)}
        options={FAMILIES.map((item) => ({
          ariaLabel: item.label,
          id: item.id,
          label: item.label,
        }))}
        size="sm"
        value={family}
      />
      <div className="grid grid-cols-2 gap-2">
        {getMockupsByFamily(family).map((definition) => {
          const selected = current?.id === definition.id
          const aspect = deviceGeometry(definition, first?.orientation).aspectRatio
          return (
            <Button variant="custom" size={null}
              aria-pressed={selected}
              className="group flex min-w-0 flex-col gap-1.5 text-left"
              key={definition.id}
              onClick={() => changeDevice(target, { definitionId: definition.id })}
              title={definition.name}
              type="button"
            >
              <span
                className={cn(
                  'flex h-24 w-full items-center justify-center overflow-hidden rounded-[10px] border p-2 transition-colors',
                  selected
                    ? 'border-foreground/25 bg-foreground/[0.1]'
                    : 'border-transparent bg-foreground/[0.04] hover:bg-foreground/[0.07]'
                )}
              >
                <span
                  className="block max-h-full"
                  style={{
                    aspectRatio: aspect,
                    height: aspect < 1 ? 80 : undefined,
                    width: aspect >= 1 ? 112 : undefined,
                  }}
                >
                  <DeviceShell
                    color={selected ? first?.color : undefined}
                    definition={definition}
                    orientation={first?.orientation}
                    screen={preview}
                  />
                </span>
              </span>
              <span
                className={cn(
                  'w-full truncate px-1 text-[10px] leading-tight',
                  selected ? 'font-medium text-foreground' : 'text-muted-foreground'
                )}
              >
                {definition.name}
              </span>
            </Button>
          )
        })}
      </div>
      {art && first ? (
        <>
          {art.colors.length > 1 ? (
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground">
                Color · {deviceArtColor(art, first.color).label}
              </span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Device color">
                {art.colors.map((color) => {
                  const selected = deviceArtColor(art, first.color).id === color.id
                  return (
                    <Button variant="custom" size={null}
                      aria-label={color.label}
                      aria-pressed={selected}
                      className={cn(
                        'size-7 rounded-full border border-foreground/15 transition-shadow',
                        selected && 'ring-2 ring-foreground/70 ring-offset-2 ring-offset-background'
                      )}
                      key={color.id}
                      onClick={() => changeDevice(target, { color: color.id })}
                      style={{ background: color.body }}
                      title={color.label}
                      type="button"
                    />
                  )
                })}
              </div>
            </div>
          ) : null}
          {art.orientations.length > 1 ? (
            <ChoiceField<DeviceOrientation>
              label="Orientation"
              onChange={(orientation) => changeDevice(target, { orientation })}
              options={deviceOrientationSchema.options
                .filter((value) => art.orientations.includes(value))
                .map((value) => ({ label: ORIENTATION_LABELS[value], value }))}
              value={first.orientation ?? art.orientations[0]!}
            />
          ) : null}
        </>
      ) : null}
      <StoreScreenshotsFeatureCard />
    </div>
  )
}
