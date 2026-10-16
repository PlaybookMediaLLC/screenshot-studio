'use client'

import * as React from 'react'
import { Slider } from '@/components/ui/slider'
import { useImageStore } from '@/lib/store'
import { ExportPresetsSection, SectionWrapper } from '../sections'

/** The canvas itself: corner radius, the space around the screenshot, and its size. */
export function CanvasSection() {
  const backgroundBorderRadius = useImageStore((state) => state.backgroundBorderRadius)
  const setBackgroundBorderRadius = useImageStore((state) => state.setBackgroundBorderRadius)
  const canvasPadding = useImageStore((state) => state.canvasPadding)
  const setCanvasPadding = useImageStore((state) => state.setCanvasPadding)

  return (
    <>
      <SectionWrapper title="Canvas" defaultOpen={false}>
        <div className="space-y-2">
          <Slider
            label="Corner radius"
            max={100}
            min={0}
            onValueChange={(value) => setBackgroundBorderRadius(value[0])}
            step={1}
            value={[backgroundBorderRadius]}
            valueDisplay={`${backgroundBorderRadius}px`}
          />
          <Slider
            label="Padding"
            max={200}
            min={0}
            onValueChange={(value) => setCanvasPadding(value[0])}
            step={1}
            value={[canvasPadding]}
            valueDisplay={`${canvasPadding}px`}
          />
        </div>
      </SectionWrapper>
      <ExportPresetsSection />
    </>
  )
}
