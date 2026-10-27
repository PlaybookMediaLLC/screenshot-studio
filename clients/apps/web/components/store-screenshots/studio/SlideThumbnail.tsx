'use client'

import * as React from 'react'
import type { StoreDocument } from '@/lib/store-screenshots/document/schema'
import type { PixelSize } from '@/lib/store-screenshots/targets'
import { useRenderServices, useSlideScene } from '../render/RenderProvider'
import { SlideRender } from '../render/SlideRender'

/**
 * A slide drawn by the shared renderer at full resolution and scaled down
 * with a CSS transform, so thumbnails, previews, and exports always match.
 * Only re-evaluates when its own slide (or shared style) changes.
 */
export const SlideThumbnail = React.memo(function SlideThumbnail({
  document,
  index,
  size,
  targetId,
  locale,
  height,
  width,
  className,
}: {
  document: StoreDocument
  index: number
  size: PixelSize
  targetId: string
  locale: string
  /** Display height in CSS pixels (or give width). */
  height?: number
  width?: number
  className?: string
}): React.JSX.Element | null {
  const scene = useSlideScene(document, index, { size, targetId, locale })
  const { resolveAsset } = useRenderServices()
  if (!scene) return null
  const scale = height ? height / size.height : (width ?? 100) / size.width
  return (
    <div className={className} style={{ width: size.width * scale, height: size.height * scale, overflow: 'hidden', position: 'relative' }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0', width: size.width, height: size.height }}>
        <SlideRender scene={scene} resolveAsset={resolveAsset} />
      </div>
    </div>
  )
})
