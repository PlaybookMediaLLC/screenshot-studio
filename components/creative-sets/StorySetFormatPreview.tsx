'use client'

import { memo, useEffect, useState } from 'react'
import { useNearViewport } from '@/components/design/DocumentPreview'
import { STORY_FORMATS, type CreativeSetDocument } from '@/lib/creative-sets/document'
import { mapDesignSources, type DesignDocument } from '@/lib/design/document'
import { fetchDesignSources } from '@/lib/design/open-design'
import { useDocumentPreview } from '@/lib/render/use-document-preview'
import { useTRPCClient } from '@/lib/trpc/react'

const FORMATS = ['wide', 'square', 'portrait'] as const
const THUMBNAIL = { format: 'jpeg', maxWidth: 480, quality: 'medium' } as const

function FormatImage({ document, name }: { document: DesignDocument; name: string }) {
  const client = useTRPCClient()
  const [resolved, setResolved] = useState<DesignDocument | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    void fetchDesignSources(client, document).then(
      (sources) => {
        if (active) setResolved(mapDesignSources(document, (src) => sources[src] ?? src))
      },
      () => {
        if (active) setFailed(true)
      }
    )
    return () => {
      active = false
    }
  }, [client, document])
  const { status, url } = useDocumentPreview(resolved, THUMBNAIL)
  if (failed || status === 'error') return <Placeholder name={name} />
  return url ? (
    <img
      src={url}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
      className="h-full w-full object-contain"
    />
  ) : (
    <div className="h-full w-full animate-pulse bg-foreground/[0.03]" />
  )
}

function Placeholder({ name }: { name: string }) {
  return (
    <div className="grid h-full w-full place-items-center bg-muted/40 text-[10px] text-muted-foreground">
      {name}
    </div>
  )
}

type Props = { setId: string; revision: number; document: CreativeSetDocument | null }

/** Saved native outputs at one common scale; never refresh connected evidence here. */
export const StorySetFormatPreview = memo(
  function StorySetFormatPreview({ document, revision }: Props) {
    const [ref, near] = useNearViewport<HTMLDivElement>()
    // Keep the trio on one story, including when that story is missing a format.
    const storyId = document?.stories[0]?.id
    return (
      <div
        ref={ref}
        className="@container rounded-lg border border-emerald-500/15 bg-emerald-500/5 p-3 sm:p-4"
      >
        <div className="grid grid-cols-[1600fr_1080fr_1080fr] items-end gap-2 sm:gap-3">
          {FORMATS.map((format) => {
            const { width, height } = STORY_FORMATS[format]
            const name = format[0].toUpperCase() + format.slice(1)
            const output = document?.outputs.find(
              (item) => item.storyId === storyId && item.format === format
            )
            return (
              <figure key={format} className="min-w-0">
                <div
                  aria-hidden="true"
                  data-story-format={format}
                  className="overflow-hidden rounded border border-emerald-500/15"
                  style={{ aspectRatio: `${width} / ${height}` }}
                >
                  {output && near ? (
                    <FormatImage
                      key={`${revision}:${output.id}`}
                      document={output.document}
                      name={name}
                    />
                  ) : (
                    <Placeholder name={name} />
                  )}
                </div>
                <figcaption className="mt-2 whitespace-nowrap text-[10px] text-muted-foreground @[500px]:text-xs">
                  {name}
                  <span className="hidden @[500px]:inline">
                    {' '}
                    · {width} × {height}
                  </span>
                </figcaption>
              </figure>
            )
          })}
        </div>
      </div>
    )
  },
  (previous, next) =>
    previous.setId === next.setId &&
    previous.revision === next.revision &&
    Boolean(previous.document) === Boolean(next.document)
)
