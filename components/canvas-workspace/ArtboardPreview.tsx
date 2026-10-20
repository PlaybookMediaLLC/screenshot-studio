'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import type { StageOutput } from '@/lib/render/capture'
import { mapDesignSources, type DesignDocument } from '@/lib/design/document'
import { fetchDesignSources } from '@/lib/design/open-design'
import { useDocumentPreview } from '@/lib/render/use-document-preview'
import { useTRPCClient } from '@/lib/trpc/react'
import { getBackgroundCSS } from '@/lib/constants/backgrounds'

/** A plain CSS stand-in for the artboard's background while its render loads or fails. */
function backgroundOf(document: DesignDocument): React.CSSProperties {
  const background = document.background
  if (!background || background.type === 'image') return { background: '#ffffff' }
  try {
    return getBackgroundCSS(
      { type: background.type, value: background.value, opacity: background.opacity },
      0
    )
  } catch {
    return { background: background.type === 'solid' ? background.value : '#ffffff' }
  }
}

/**
 * An inactive artboard, drawn by the editor's own renderer into a cached
 * image at a width bucket that suits the zoom. Off-screen artboards are not
 * rendered at all; an obsolete render is cancelled when the document or
 * size changes, and the previous image stays up meanwhile.
 */
export const ArtboardPreview = memo(
  function ArtboardPreview({
    document,
    name,
    width,
    enabled,
  }: {
    document: DesignDocument
    name: string
    width: number
    enabled: boolean
  }) {
    const client = useTRPCClient()
    const [resolved, setResolved] = useState<{
      source: DesignDocument
      document: DesignDocument | null
      error: string | null
    } | null>(null)
    useEffect(() => {
      if (!enabled) return
      let active = true
      fetchDesignSources(client, document).then(
        (urls) => {
          if (active)
            setResolved({
              source: document,
              document: Object.keys(urls).length
                ? mapDesignSources(document, (ref) => urls[ref] ?? ref)
                : document,
              error: null,
            })
        },
        () => {
          if (active)
            setResolved({ source: document, document: null, error: 'An image is unavailable' })
        }
      )
      return () => {
        active = false
      }
    }, [client, document, enabled])
    const output = useMemo<StageOutput>(
      () => ({ format: 'jpeg', quality: 'medium', maxWidth: width }),
      [width]
    )
    const current = resolved?.source === document ? resolved : null
    const { status, url } = useDocumentPreview(current?.document ?? null, output, { enabled })
    return (
      <div className="absolute inset-0 overflow-hidden" style={backgroundOf(document)}>
        {url ? (
          <img
            alt={name}
            src={url}
            draggable={false}
            className="pointer-events-none h-full w-full select-none"
          />
        ) : null}
        {!url && (status === 'error' || current?.error) ? (
          <p className="absolute inset-0 grid place-items-center p-2 text-center text-[11px] text-muted-foreground">
            {current?.error ?? 'Preview unavailable'}
          </p>
        ) : null}
        {!url && status === 'rendering' ? (
          <div aria-hidden className="absolute inset-0 animate-pulse bg-foreground/[0.05]" />
        ) : null}
      </div>
    )
  },
  (previous, next) =>
    previous.width === next.width &&
    previous.enabled === next.enabled &&
    previous.name === next.name &&
    (previous.document === next.document ||
      documentKey(previous.document) === documentKey(next.document))
)

const keys = new WeakMap<DesignDocument, string>()
/** A content key, computed once per document object. Commands clone documents; content rarely changes. */
function documentKey(document: DesignDocument): string {
  let key = keys.get(document)
  if (key === undefined) {
    key = JSON.stringify(document)
    keys.set(document, key)
  }
  return key
}
