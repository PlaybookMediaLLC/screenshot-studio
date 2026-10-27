'use client'

import * as React from 'react'
import { createDocumentFromTemplate, type StoreTemplate } from '@/lib/store-screenshots/templates'
import {
  DEFAULT_TARGET_ID,
  getStoreTargetOrDefault,
  targetPixelSize,
} from '@/lib/store-screenshots/targets'
import { RenderProvider } from './render/RenderProvider'
import { SlideThumbnail } from './studio/SlideThumbnail'

/** Uses the studio renderer without opening or modifying a saved project. */
export function StoreTemplatePreview({ template }: { template: StoreTemplate }): React.JSX.Element {
  const [document] = React.useState(() => createDocumentFromTemplate(template))
  const size = targetPixelSize(getStoreTargetOrDefault(DEFAULT_TARGET_ID))
  return (
    <RenderProvider document={document}>
      <div className="flex gap-1.5 overflow-hidden">
        {document.slides.slice(0, 4).map((slide, index) => (
          <SlideThumbnail
            key={slide.id}
            document={document}
            index={index}
            size={size}
            targetId={DEFAULT_TARGET_ID}
            locale="en-US"
            height={170}
            className="shrink-0 rounded ring-1 ring-foreground/10"
          />
        ))}
      </div>
    </RenderProvider>
  )
}
