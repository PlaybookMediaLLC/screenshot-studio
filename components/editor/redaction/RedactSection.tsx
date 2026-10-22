'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { useDeviceUIStore } from '@/lib/store/device-ui'
import { useImageStore } from '@/lib/store'
import { SectionWrapper } from '../sections/SectionWrapper'
import { RedactionReviewDialog } from './RedactionReviewDialog'

/**
 * Find and cover sensitive information in the screenshot: scan on this
 * device, review every suggestion, then apply them to the pixels.
 */
export function RedactSection() {
  const primaryUrl = useImageStore((state) => state.uploadedImageUrl)
  const mockups = useImageStore((state) => state.mockups)
  const editorMode = useImageStore((state) => state.editorMode)
  const selectedDeviceId = useDeviceUIStore((state) => state.selectedDeviceId)
  const [chosenId, setChosenId] = React.useState<string | null>(null)
  const screens = editorMode === 'device' ? mockups.filter((screen) => screen.screen.src && !screen.screen.code) : []
  const screen = screens.find((screen) => screen.id === (chosenId ?? selectedDeviceId)) ?? screens[0]
  const imageUrl = screen?.screen.src ?? primaryUrl
  const [mode, setMode] = React.useState<'closed' | 'scan' | 'manual'>('closed')
  return (
    <SectionWrapper defaultOpen={false} title="Redact">
      <div className="space-y-2">
        <p className="text-[11px] leading-snug text-muted-foreground">
          Find emails, API keys, card numbers, names, and faces, review them, and cover them for good. Runs on this
          device.
        </p>
        {screens.length > 0 ? (
          <label className="grid gap-1 text-xs">
            Screenshot to redact
            <select className="w-full rounded border bg-background p-2" value={screen?.id} onChange={(event) => setChosenId(event.target.value)}>
              {screens.map((item, index) => <option key={item.id} value={item.id}>Screen {index + 1}: {item.screen.name ?? 'Screenshot'}</option>)}
            </select>
            <span className="text-muted-foreground">Scan each screen before exporting the composition.</span>
          </label>
        ) : null}
        <div className="grid grid-cols-2 gap-1.5">
          <Button className="h-8 text-xs" disabled={!imageUrl} onClick={() => setMode('scan')} size="sm">
            Scan screenshot
          </Button>
          <Button className="h-8 text-xs" disabled={!imageUrl} onClick={() => setMode('manual')} size="sm" variant="outline">
            Draw regions
          </Button>
        </div>
      </div>
      <RedactionReviewDialog
        imageUrl={imageUrl}
        onOpenChange={(open) => setMode(open ? mode : 'closed')}
        open={mode !== 'closed'}
        scan={mode === 'scan'}
      />
    </SectionWrapper>
  )
}
