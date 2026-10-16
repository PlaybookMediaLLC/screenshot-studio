'use client'

import * as React from 'react'
import { DocumentPreview, useNearViewport } from '@/components/design/DocumentPreview'
import { type DesignDocument, mapDesignSources } from '@/lib/design/document'
import { fetchDesignSources } from '@/lib/design/open-design'
import { useTRPCClient } from '@/lib/trpc/react'
import { cn } from '@/lib/utils'

type Resolved = { document: DesignDocument | null; source: DesignDocument }

/**
 * A stored document drawn by the editor's stage. Its workspace images are
 * fetched once the preview nears the viewport, the way the editor loads them.
 * `document` is null for a design this editor cannot read.
 */
export function ProjectPreview({
  alt,
  className,
  document,
}: {
  alt: string
  className?: string
  document: DesignDocument | null
}) {
  const trpcClient = useTRPCClient()
  const [ref, near] = useNearViewport<HTMLDivElement>()
  const [resolved, setResolved] = React.useState<Resolved | null>(null)

  React.useEffect(() => {
    if (!near || !document) return
    let active = true
    fetchDesignSources(trpcClient, document)
      .then((urls) => {
        const local = Object.keys(urls).length
          ? mapDesignSources(document, (src) => urls[src] ?? src)
          : document
        if (active) setResolved({ document: local, source: document })
      })
      .catch(() => {
        if (active) setResolved({ document: null, source: document })
      })
    return () => {
      active = false
    }
  }, [document, near, trpcClient])

  const current = resolved?.source === document ? resolved : null
  return (
    <div
      className={cn('relative h-full w-full overflow-hidden bg-foreground/[0.03]', className)}
      ref={ref}
    >
      {current?.document ? (
        <DocumentPreview alt={alt} document={current.document} />
      ) : !document || current ? (
        <p className="absolute inset-0 grid place-items-center text-[10px] text-muted-foreground">
          Preview unavailable
        </p>
      ) : (
        <div aria-hidden className="absolute inset-0 animate-pulse bg-foreground/[0.06]" />
      )}
    </div>
  )
}
