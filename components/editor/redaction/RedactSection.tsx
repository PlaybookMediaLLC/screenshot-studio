'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { useImageStore } from '@/lib/store'
import { SectionWrapper } from '../sections/SectionWrapper'
import { RedactionReviewDialog } from './RedactionReviewDialog'

/**
 * Find and cover sensitive information in the screenshot: scan on this
 * device, review every suggestion, then apply them to the pixels.
 */
export function RedactSection() {
  const imageUrl = useImageStore((state) => state.uploadedImageUrl)
  const [mode, setMode] = React.useState<'closed' | 'scan' | 'manual'>('closed')
  return (
    <SectionWrapper defaultOpen={false} title="Redact">
      <div className="space-y-2">
        <p className="text-[11px] leading-snug text-muted-foreground">
          Find emails, API keys, card numbers, names, and faces, review them, and cover them for good. Runs on this
          device.
        </p>
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
