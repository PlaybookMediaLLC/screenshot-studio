'use client'

import * as React from 'react'
import { MagicWand01Icon, RefreshIcon } from 'hugeicons-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import {
  autoEnhanceFilters,
  hasImageAdjustments,
  IMAGE_ADJUSTMENTS,
  measureImage,
  NEUTRAL_IMAGE_FILTERS,
} from '@/lib/editor/image-adjustments'
import { useImageStore } from '@/lib/store'
import { SectionWrapper } from './SectionWrapper'

const GROUP_LABELS = { color: 'Color', effects: 'Effects', light: 'Light' } as const

/**
 * The screenshot's image adjustments, in one place. Auto enhance is a
 * separate operation: it measures the screenshot and sets the manual
 * sliders, which stay editable afterwards.
 */
export function AdjustSection() {
  const imageFilters = useImageStore((state) => state.imageFilters)
  const uploadedImageUrl = useImageStore((state) => state.uploadedImageUrl)
  const setImageFilter = useImageStore((state) => state.setImageFilter)
  const [enhancing, setEnhancing] = React.useState(false)
  const changed = hasImageAdjustments(imageFilters)

  const autoEnhance = async () => {
    if (!uploadedImageUrl) return
    setEnhancing(true)
    try {
      const filters = autoEnhanceFilters(await measureImage(uploadedImageUrl))
      useImageStore.setState({ imageFilters: filters })
      toast.success('Auto enhance applied', {
        description: hasImageAdjustments(filters)
          ? 'Adjust any value below, or reset.'
          : 'The screenshot already looks balanced.',
      })
    } catch {
      toast.error('Could not read the screenshot to enhance it.')
    } finally {
      setEnhancing(false)
    }
  }

  return (
    <SectionWrapper title="Adjust image" defaultOpen={false}>
      <div className="space-y-3">
        <p className="text-[11px] leading-snug text-muted-foreground">
          Applies to the screenshot and every device screen showing it.
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            className="h-8 gap-1.5 text-xs"
            disabled={!uploadedImageUrl || enhancing}
            onClick={() => void autoEnhance()}
            size="sm"
            variant="outline"
          >
            <MagicWand01Icon size={14} />
            {enhancing ? 'Enhancing…' : 'Auto enhance'}
          </Button>
          <Button
            className="h-8 gap-1.5 text-xs"
            disabled={!changed}
            onClick={() => useImageStore.setState({ imageFilters: { ...NEUTRAL_IMAGE_FILTERS } })}
            size="sm"
            variant="ghost"
          >
            <RefreshIcon size={14} />
            Reset
          </Button>
        </div>
        {(Object.keys(GROUP_LABELS) as (keyof typeof GROUP_LABELS)[]).map((group) => (
          <div className="space-y-2" key={group}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {GROUP_LABELS[group]}
            </p>
            {IMAGE_ADJUSTMENTS.filter((control) => control.group === group).map((control) => (
              <Slider
                key={control.key}
                label={control.label}
                max={control.max}
                min={control.min}
                onValueChange={(value) => setImageFilter(control.key, value[0])}
                step={control.step}
                value={[imageFilters[control.key]]}
                valueDisplay={`${imageFilters[control.key]}${control.unit}`}
              />
            ))}
          </div>
        ))}
      </div>
    </SectionWrapper>
  )
}
