'use client'

import * as React from 'react'
import { linkedInPostIdentity } from '@/lib/write/linkedin-target'
import { Button } from '@/components/ui/button'
import { draftsApi } from '@/lib/content-drafts/client'
import { linkPreviewSchema, type DraftChannel, type LinkPreview } from '@/lib/write/document'

/** HTTPS links in the visible platform version, in document order. */
export function previewLinks(text: string): string[] {
  return [
    ...new Set(
      (text.match(/https:\/\/[^\s<>"']+/g) ?? []).map((url) => url.replace(/[).,!?;]+$/, ''))
    ),
  ]
    .filter((url) => {
      try {
        return (
          new URL(url).hostname.includes('.') && linkPreviewSchema.shape.url.safeParse(url).success
        )
      } catch {
        return false
      }
    })
    .slice(0, 25)
}

/** Stored metadata is shared by the composer and publication preview. */
export function LinkPreviewCard({ card }: { card: LinkPreview }) {
  if (card.removed) return null
  return (
    <div
      className="my-2 overflow-hidden rounded-lg border border-input"
      data-testid="link-preview-card"
    >
      {card.image ? <img alt="" src={card.image} className="max-h-48 w-full object-cover" /> : null}
      <div className="p-3 text-sm">
        <p className="font-medium">{card.title || card.url}</p>
        <p className="line-clamp-3 text-xs text-muted-foreground">{card.description}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{card.url}</p>
      </div>
    </div>
  )
}

/** Fetch Open Graph data once per link and persist deliberate removal choices. */
export function LinkCards({
  text,
  channel,
  cards,
  onChange,
  onQuote,
}: {
  text: string
  channel: DraftChannel
  cards: LinkPreview[]
  onChange: (card: LinkPreview) => void
  onQuote?: (url: string) => void
}) {
  const links = previewLinks(text)
  const key = links.join('\n')
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [retry, setRetry] = React.useState(0)
  const current = React.useEffectEvent(() => cards)
  const save = React.useEffectEvent(onChange)
  React.useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      for (const url of key.split('\n').filter(Boolean)) {
        if (current().some((card) => card.url === url)) continue
        void draftsApi
          .linkCard(url)
          .then((card) => {
            if (cancelled) return
            save({
              url,
              title: (card.title ?? '').slice(0, 250),
              description: (card.description ?? '').slice(0, 1000),
              ...(card.image?.startsWith('https://') ? { image: card.image } : {}),
            })
            setErrors((previous) => {
              const next = { ...previous }
              delete next[url]
              return next
            })
          })
          .catch(() => {
            if (!cancelled)
              setErrors((previous) => ({ ...previous, [url]: 'Preview could not be loaded.' }))
          })
      }
    }, 600)
    return () => {
      window.clearTimeout(timer)
      cancelled = true
    }
  }, [key, retry])
  if (!links.length) return null
  return (
    <section aria-label="Link previews" className="mx-4 my-2 max-w-xl space-y-2">
      {links.map((url) => {
        const card = cards.find((item) => item.url === url)
        const quote =
          Boolean(linkedInPostIdentity(url)) ||
          /^https:\/\/(?:www\.)?(?:(?:x|twitter)\.com\/[^/]+\/status\/\d+|bsky\.app\/profile\/[^/]+\/post\/)/.test(
            url
          ) ||
          /^https:\/\/[^/@:]+\/(?:@[^/]+\/|users\/[^/]+\/statuses\/|statuses\/)\d+$/.test(url)
        return (
          <div key={url}>
            {card?.removed ? (
              <p className="text-xs text-muted-foreground">Preview removed for {url}</p>
            ) : card ? (
              <LinkPreviewCard card={card} />
            ) : (
              <p role="status" className="text-xs text-muted-foreground">
                {errors[url] || 'Loading link preview…'}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {card ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange({ ...card, removed: !card.removed })}
                >
                  {card.removed ? 'Restore preview' : 'Remove preview'}
                </Button>
              ) : errors[url] ? (
                <Button size="sm" variant="ghost" onClick={() => setRetry((value) => value + 1)}>
                  Retry preview
                </Button>
              ) : null}
              {quote && onQuote ? (
                <Button size="sm" variant="ghost" onClick={() => onQuote(url)}>
                  Open as quote draft
                </Button>
              ) : null}
            </div>
            {card?.removed && channel !== 'bluesky' ? (
              <p role="status" className="text-xs text-amber-700 dark:text-amber-300">
                This provider cannot confirm preview removal through its API. Restore the preview
                before publishing.
              </p>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}
