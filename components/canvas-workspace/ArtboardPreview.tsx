'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import type { StageOutput } from '@/lib/render/capture'
import { mapDesignSources, type DesignDocument } from '@/lib/design/document'
import { fetchDesignSources } from '@/lib/design/open-design'
import { useDocumentPreview } from '@/lib/render/use-document-preview'
import { useTRPCClient } from '@/lib/trpc/react'
import { getBackgroundCSS } from '@/lib/constants/backgrounds'
import { readStoredPreview, storedPreviewKey, writeStoredPreview } from '@/lib/canvas/preview-store'

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
    const output = useMemo<StageOutput>(
      () => ({ format: 'jpeg', quality: 'medium', maxWidth: width }),
      [width]
    )
    // A preview kept from an earlier visit shows at once and skips rendering.
    const storedKey = useMemo(() => storedPreviewKey(document, width), [document, width])
    const [stored, setStored] = useState<{ key: string; url: string | null } | null>(null)
    useEffect(() => {
      if (!enabled) return
      let active = true
      void readStoredPreview(storedKey).then((blob) => {
        if (!active) return
        const url = blob ? URL.createObjectURL(blob) : null
        // The image it replaces stays up until now; the effect below releases it.
        setStored({ key: storedKey, url })
      })
      return () => {
        active = false
      }
    }, [storedKey, enabled])
    useEffect(() => () => void (stored?.url && URL.revokeObjectURL(stored.url)), [stored])
    const kept = stored?.key === storedKey ? stored : null
    const rendering = enabled && kept !== null && !kept.url
    const [resolved, setResolved] = useState<{
      source: DesignDocument
      document: DesignDocument | null
      error: string | null
    } | null>(null)
    useEffect(() => {
      if (!rendering) return
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
    }, [client, document, rendering])
    const current = resolved?.source === document ? resolved : null
    const rendered = useDocumentPreview(current?.document ?? null, output, { enabled: rendering })
    useEffect(() => {
      if (!rendering || rendered.status !== 'ready' || !rendered.url) return
      void fetch(rendered.url)
        .then((response) => response.blob())
        .then((blob) => writeStoredPreview(storedKey, blob))
        .catch(() => undefined)
    }, [rendering, rendered.status, rendered.url, storedKey])
    const url = kept?.url ?? rendered.url ?? stored?.url ?? null
    const status = url ? 'ready' : rendered.status
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
