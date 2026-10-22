'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { DocumentPreview, useNearViewport } from '@/components/design/DocumentPreview'
import { type DesignDocument, mapDesignSources } from '@/lib/design/document'
import { fetchDesignSources } from '@/lib/design/open-design'
import { useTRPCClient } from '@/lib/trpc/react'
import { cn } from '@/lib/utils'
import { isEmptyProject } from '@/lib/projects/empty'

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
  retryable = false,
}: {
  alt: string
  className?: string
  document: DesignDocument | null
  retryable?: boolean
}) {
  const trpcClient = useTRPCClient()
  const [ref, near] = useNearViewport<HTMLDivElement>()
  const [resolved, setResolved] = React.useState<Resolved | null>(null)
  const [attempt, setAttempt] = React.useState(0)
  const empty = document !== null && isEmptyProject(document)

  React.useEffect(() => {
    if (!near || !document || empty) return
    let active = true
    setResolved(null)
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
  }, [document, empty, near, trpcClient, attempt])

  const current = resolved?.source === document ? resolved : null
  return (
    <div
      className={cn('relative h-full w-full overflow-hidden bg-foreground/[0.03]', className)}
      ref={ref}
    >
      {empty ? (
        <p className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
          Empty project
        </p>
      ) : current?.document ? (
        <DocumentPreview
          key={attempt}
          alt={alt}
          document={current.document}
          onRetry={retryable ? () => setAttempt((value) => value + 1) : undefined}
        />
      ) : !document ? (
        <p className="absolute inset-0 grid place-items-center p-3 text-center text-xs text-muted-foreground">
          This format has no preview. Open the original editor.
        </p>
      ) : current ? (
        <div
          role="status"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-xs text-muted-foreground"
        >
          <p>Preview sources could not load. Your saved project is unchanged.</p>
          {retryable ? (
            <Button
              className="relative z-10"
              size="sm"
              variant="outline"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setAttempt((value) => value + 1)
              }}
            >
              Retry preview
            </Button>
          ) : null}
        </div>
      ) : (
        <div
          role="status"
          aria-label="Loading preview"
          className="absolute inset-0 animate-pulse bg-foreground/[0.06]"
        />
      )}
    </div>
  )
}
