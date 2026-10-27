'use client'

import type { CSSProperties } from 'react'
import { Stage } from '@/components/platform-landing/primitives'
import { MiniPage } from '@/components/platform-ui/page-spread'
import { memo, useEffect, useState } from 'react'
import { useNearViewport } from '@/components/design/DocumentPreview'
import { STORY_FORMATS, type CreativeSetDocument } from '@/lib/creative-sets/document'
import { mapDesignSources, type DesignDocument } from '@/lib/design/document'
import { fetchDesignSources } from '@/lib/design/open-design'
import { useDocumentPreview } from '@/lib/render/use-document-preview'
import { useTRPCClient } from '@/lib/trpc/react'

const FORMATS = ['wide', 'square', 'portrait'] as const
const PAGE_RATIOS = { wide: '16:9', square: '1:1', portrait: '4:5' } as const
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
      // The three formats as pages on the landing page's stage, like a spread.
      <div ref={ref} className="@container">
        <Stage className="rounded-[10px] px-3 py-5 sm:px-6 sm:py-8">
          <div className="grid w-full grid-cols-[1600fr_1080fr_1080fr] items-end gap-3 sm:gap-4">
            {FORMATS.map((format, index) => {
              const { width, height } = STORY_FORMATS[format]
              const name = format[0].toUpperCase() + format.slice(1)
              const output = document?.outputs.find(
                (item) => item.storyId === storyId && item.format === format
              )
              return (
                <figure
                  key={format}
                  className="page-spread-item flex min-w-0 flex-col items-center"
                  style={{ '--i': index } as CSSProperties}
                >
                  <div
                    aria-hidden="true"
                    data-story-format={format}
                    className="page-spread-page w-full overflow-hidden rounded-[5px] bg-[#f4f4f2] ring-1 ring-black/10"
                    style={{ aspectRatio: `${width} / ${height}` }}
                  >
                    {output && near ? (
                      <FormatImage
                        key={`${revision}:${output.id}`}
                        document={output.document}
                        name={name}
                      />
                    ) : (
                      // Not rendered yet: a ghost of a launch visual in this format, named.
                      <span className="relative block size-full">
                        <MiniPage
                          className="size-full rounded-none opacity-35 ring-0"
                          kind="hero"
                          ratio={PAGE_RATIOS[format]}
                        />
                        <span className="absolute inset-0 grid place-items-center">
                          <span className="page-spread-number">{name}</span>
                        </span>
                      </span>
                    )}
                  </div>
                  <figcaption className="page-spread-number mt-2 whitespace-nowrap @[500px]:text-[11px]">
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
        </Stage>
      </div>
    )
  },
  (previous, next) =>
    previous.setId === next.setId &&
    previous.revision === next.revision &&
    Boolean(previous.document) === Boolean(next.document)
)
