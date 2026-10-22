'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import type { DesignDocument } from '@/lib/design/document'
import type { StageOutput } from '@/lib/render/capture'
import { useDocumentPreview } from '@/lib/render/use-document-preview'
import { cn } from '@/lib/utils'

const PREVIEW_OUTPUT: StageOutput = { format: 'jpeg', maxWidth: 480, quality: 'medium' }

/** True once the element has been near the viewport; previews render lazily. */
export function useNearViewport<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = React.useRef<T>(null)
  const [near, setNear] = React.useState(false)
  React.useEffect(() => {
    const element = ref.current
    if (!element || near) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true)
      },
      { rootMargin: '200px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [near])
  return [ref, near]
}

/**
 * A document drawn by the editor's own stage, for thumbnails of presets,
 * variants, and projects. What it shows is what applying or exporting the
 * document produces.
 */
export function DocumentPreview({
  alt,
  className,
  document,
  output = PREVIEW_OUTPUT,
  onRetry,
  time,
}: {
  alt: string
  className?: string
  document: DesignDocument | null
  onRetry?: () => void
  output?: StageOutput
  time?: number
}) {
  const [ref, near] = useNearViewport<HTMLDivElement>()
  const { status, url } = useDocumentPreview(document, output, { enabled: near, time })
  return (
    <div className={cn('relative h-full w-full overflow-hidden', className)} ref={ref}>
      {url ? (
        <img alt={alt} className="h-full w-full object-contain" draggable={false} src={url} />
      ) : null}
      {status === 'rendering' && !url ? (
        <div aria-hidden className="absolute inset-0 animate-pulse bg-foreground/[0.06]" />
      ) : null}
      {status === 'error' && !url ? (
        <div
          role="status"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-xs text-muted-foreground"
        >
          <p>Preview could not render. Open the original to keep working.</p>
          {onRetry ? (
            <Button
              className="relative z-10"
              size="sm"
              variant="outline"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onRetry()
              }}
            >
              Retry preview
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
