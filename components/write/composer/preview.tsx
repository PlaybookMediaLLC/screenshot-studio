'use client'

import * as React from 'react'
import { LinkPreviewCard } from './link-cards'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CHANNEL_META, ChannelIcon } from '@/components/drafts/channel-meta'
import { assetContentUrl } from '@/lib/editor/services'
import { CAPABILITIES } from '@/lib/write/capabilities'
import type { DraftChannel, DraftTarget } from '@/lib/write/document'
import type { Publication } from '@/lib/write/publication'
import { cn } from '@/lib/utils'
import type { ComposerAccount } from './platforms'
import { PdfCarousel } from './pdf-carousel'

/** Devices the mobile preview lays out for, at their CSS viewport sizes. */
const DEVICES = [
  { height: 667, label: 'iPhone SE', width: 375 },
  { height: 852, label: 'iPhone 16', width: 393 },
  { height: 874, label: 'iPhone 17 / Pro', width: 402 },
  { height: 912, label: 'iPhone Air', width: 420 },
  { height: 956, label: 'iPhone 17 Pro Max', width: 440 },
  { height: 780, label: 'Samsung Galaxy S25', width: 360 },
  { height: 915, label: 'Google Pixel 10', width: 412 },
] as const

/** Where a platform cuts a long post with "more": X shows 280 before "Show more"; LinkedIn about 210. */
const CUTOFFS: Partial<Record<DraftChannel, number>> = { linkedin: 210, x: 280 }

/** One destination's preview: its account and its publication. */
export type PreviewItem = { account: ComposerAccount; publication: Publication }

/**
 * The realistic preview (RFC 042): each destination laid out as its
 * platform shows it, from the same publication the schedule sends, on a
 * desktop column or a chosen phone. It shows no engagement numbers: nothing
 * here is published, and the banner says so. It never publishes.
 */
export function PreviewPanel({
  items,
  target,
}: {
  items: PreviewItem[]
  target: DraftTarget | null
}) {
  const [channel, setChannel] = React.useState<DraftChannel | null>(
    items[0]?.account.channel ?? null
  )
  const [device, setDevice] = React.useState<'desktop' | (typeof DEVICES)[number]['label']>(
    'desktop'
  )
  const item = items.find((entry) => entry.account.channel === channel) ?? items[0]
  const size = DEVICES.find((entry) => entry.label === device)
  if (!item) {
    return <p className="p-4 text-sm text-neutral-400">Turn on a platform to preview it.</p>
  }
  return (
    <div className="flex flex-col gap-3 p-4" data-testid="preview-panel">
      <p className="rounded-md border border-dashed border-white/15 px-2 py-1 text-center text-[11px] text-neutral-400">
        Preview — not published. No engagement is shown because none exists yet.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {items.map((entry) => (
          <Button
            aria-pressed={entry.account.channel === item.account.channel}
            className={cn(
              'flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
              entry.account.channel === item.account.channel
                ? 'border-white/30 text-white'
                : 'border-white/10 text-neutral-400'
            )}
            key={entry.account.id}
            onClick={() => setChannel(entry.account.channel)}
            size={null}
            type="button"
            variant="custom"
          >
            <ChannelIcon channel={entry.account.channel} />
            {CHANNEL_META[entry.account.channel].label}
          </Button>
        ))}
        <Select onValueChange={(value) => setDevice(value as typeof device)} value={device}>
          <SelectTrigger aria-label="Preview device" className="ml-auto h-7 w-auto text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desktop">Desktop</SelectItem>
            {DEVICES.map((entry) => (
              <SelectItem key={entry.label} value={entry.label}>
                {entry.label} · {entry.width}×{entry.height}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div
        className={cn(
          'mx-auto w-full overflow-y-auto rounded-2xl border border-white/10 bg-black',
          size ? 'shadow-2xl' : ''
        )}
        data-testid={`preview-${item.account.channel}`}
        style={size ? { height: Math.min(size.height, 720), width: size.width } : undefined}
      >
        {item.publication.target.options?.articleTitle ? (
          <ArticlePreview item={item} />
        ) : item.account.channel === 'linkedin' ? (
          <LinkedInPost item={item} target={target} />
        ) : (
          <ThreadPreview item={item} target={target} />
        )}
      </div>
      {item.publication.problems.length > 0 ? (
        <ul className="grid gap-0.5" role="alert">
          {item.publication.problems.map((problem) => (
            <li className="text-xs text-red-300" key={problem}>
              {problem}
            </li>
          ))}
        </ul>
      ) : null}
      {item.publication.serialized.degradations.map((degradation) => (
        <p className="text-xs text-amber-300" key={degradation.kind}>
          {degradation.message}
        </p>
      ))}
    </div>
  )
}

/** An account's avatar, or its initial. */
function Avatar({ account, size = 'size-10' }: { account: ComposerAccount; size?: string }) {
  return account.avatarUrl ? (
    // biome-ignore lint/performance/noImgElement: a provider avatar URL
    <img
      alt=""
      className={cn(size, 'shrink-0 rounded-full bg-white/5 object-cover')}
      src={account.avatarUrl}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        size,
        'flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500/40 to-violet-500/40 text-sm text-white'
      )}
    >
      {(account.displayName ?? account.handle ?? '?').slice(0, 1).toUpperCase()}
    </span>
  )
}

/** Text cut where the platform shows "more", with the rest one tap away. */
function Truncated({ channel, text }: { channel: DraftChannel; text: string }) {
  const [open, setOpen] = React.useState(false)
  const cutoff = CUTOFFS[channel]
  const lines = text.split('\n')
  const long =
    cutoff !== undefined &&
    ([...text].length > cutoff || (channel === 'linkedin' && lines.length > 3))
  const shown =
    !long || open
      ? text
      : channel === 'linkedin'
        ? lines.slice(0, 3).join('\n').slice(0, cutoff)
        : [...text].slice(0, cutoff).join('')
  return (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-snug text-neutral-100">
      <Mentions channel={channel} text={shown} />
      {long && !open ? (
        <>
          {channel === 'linkedin' ? '… ' : ' '}
          <Button
            className="text-neutral-400 hover:underline"
            onClick={() => setOpen(true)}
            size={null}
            type="button"
            variant="custom"
          >
            {channel === 'linkedin' ? 'more' : 'Show more'}
          </Button>
        </>
      ) : null}
    </p>
  )
}

/** Mentions and links drawn in the platform's link colour; LinkedIn annotations by their name. */
function Mentions({ channel, text }: { channel: DraftChannel; text: string }) {
  const parts = text.split(
    /(@\[(?:\\.|[^\]\\])+\]\(urn:li:(?:organization:[0-9]{1,30}|person:[A-Za-z0-9_-]{1,100})\)|@[A-Za-z0-9_]{1,30}|https?:\/\/\S+)/g
  )
  return (
    <>
      {parts.map((part, index) => {
        const annotation = /^@\[((?:\\.|[^\]\\])+)\]/.exec(part)
        if (annotation)
          return (
            <span className="font-medium text-sky-400" key={index}>
              {annotation[1].replace(/\\([\\|{}@[\]()<>#*_~])/g, '$1')}
            </span>
          )
        if (/^@|^https?:/.test(part))
          return (
            <span className={channel === 'linkedin' ? 'text-sky-400' : 'text-sky-400'} key={index}>
              {part}
            </span>
          )
        return <React.Fragment key={index}>{part}</React.Fragment>
      })}
    </>
  )
}

/** A post's images in the platform's grid. */
function Media({
  assetIds,
  channel,
  videos = 0,
}: {
  assetIds: string[]
  channel: DraftChannel
  videos?: number
}) {
  const shown = assetIds.slice(0, CAPABILITIES[channel].media.imageLimit)
  if (shown.length === 0) return null
  return (
    <div
      className={cn(
        'mt-2 grid gap-0.5 overflow-hidden rounded-2xl border border-white/10',
        shown.length > 1 && 'grid-cols-2'
      )}
    >
      {shown.map((assetId) =>
        videos > 0 ? (
          <video
            key={assetId}
            controls
            playsInline
            preload="metadata"
            className="aspect-video w-full bg-black object-contain"
            src={assetContentUrl(assetId)}
            aria-label="Attached video preview"
          />
        ) : (
          // biome-ignore lint/performance/noImgElement: signed asset redirects
          <img
            alt=""
            className="aspect-video w-full bg-white/5 object-cover"
            key={assetId}
            src={assetContentUrl(assetId)}
          />
        )
      )}
    </div>
  )
}

/** A poll as the platform draws it before anyone votes: options, no counts. */
function Poll({
  channel,
  poll,
  question,
}: {
  channel: DraftChannel
  poll: NonNullable<Publication['target']['poll']>
  question?: string
}) {
  return (
    <div
      className="mt-2 grid gap-1.5 rounded-xl border border-white/10 p-3"
      data-testid={`preview-poll-${channel}`}
    >
      {question ? <p className="text-sm font-medium text-white">{question}</p> : null}
      {poll.options.map((option, index) => (
        <span
          className="rounded-full border border-sky-400/50 px-3 py-1 text-center text-sm text-sky-300"
          key={index}
        >
          {option || `Option ${index + 1}`}
        </span>
      ))}
      <p className="text-[11px] text-neutral-400">
        {poll.durationMinutes >= 1_440
          ? `${poll.durationMinutes / 1_440} day${poll.durationMinutes === 1_440 ? '' : 's'}`
          : `${poll.durationMinutes} minutes`}{' '}
        left
      </p>
    </div>
  )
}

/** The post a reply answers or a quote embeds, as a card. */
function TargetCard({ target }: { target: DraftTarget }) {
  return (
    <div
      className="mt-2 rounded-xl border border-white/10 p-3 text-sm text-neutral-300"
      data-testid="preview-target"
    >
      <p className="text-[11px] text-neutral-400">{target.author ?? target.url}</p>
      {target.text ? (
        <p className="mt-1 line-clamp-3">{target.text}</p>
      ) : (
        <p className="mt-1 text-neutral-400">Quoted post</p>
      )}
    </div>
  )
}

/** An X (or other thread platform) thread: one post under the other, joined by a line. */
function ThreadPreview({ item, target }: { item: PreviewItem; target: DraftTarget | null }) {
  const { account, publication } = item
  const channel = account.channel
  const posts = publication.serialized.posts
  return (
    <div className="p-3">
      {target?.kind === 'reply' ? (
        <p className="mb-2 text-xs text-neutral-400">Replying to {target.author ?? target.url}</p>
      ) : null}
      {(posts.length > 0
        ? posts
        : [{ assetIds: [], caption: '', group: 0, images: 0, length: 0, videos: 0 }]
      ).map((post, index, list) => {
        const settings = publication.settings[index] ?? {}
        return (
          <article className="relative flex gap-3 pb-4" key={index}>
            {index < list.length - 1 ? (
              <span aria-hidden className="absolute top-12 bottom-0 left-5 w-px bg-white/15" />
            ) : null}
            <Avatar account={account} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <span className="font-semibold text-white">
                  {account.displayName ?? account.handle ?? CHANNEL_META[channel].label}
                </span>
                {account.handle ? (
                  <span className="ml-1 text-neutral-400">@{account.handle}</span>
                ) : null}
                <span className="ml-1 text-neutral-400">· now</span>
              </p>
              <Truncated channel={channel} text={post.caption} />
              <Media assetIds={post.assetIds} channel={channel} videos={post.videos} />
              {settings.poll ? <Poll channel={channel} poll={settings.poll} /> : null}
              {(
                index === 0
                  ? publication.target.options?.linkPreview
                  : publication.target.replies?.[index - 1]?.options?.linkPreview
              ) ? (
                <LinkPreviewCard
                  card={
                    (index === 0
                      ? publication.target.options?.linkPreview
                      : publication.target.replies?.[index - 1]?.options?.linkPreview)!
                  }
                />
              ) : null}
              {index === 0 && target?.kind === 'quote' ? <TargetCard target={target} /> : null}
              {settings.quoteFirstPost ? (
                <div className="mt-2 rounded-xl border border-dashed border-white/15 p-2 text-xs text-neutral-400">
                  Quotes the first post once it is live
                </div>
              ) : null}
              {settings.disclosures?.madeWithAi || settings.disclosures?.paidPartnership ? (
                <p className="mt-1 text-[11px] text-neutral-400">
                  {[
                    settings.disclosures.paidPartnership ? 'Paid partnership' : '',
                    settings.disclosures.madeWithAi ? 'Made with AI' : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
              {settings.replySettings && settings.replySettings !== 'everyone' ? (
                <p className="mt-1 text-[11px] text-sky-400">Some accounts can’t reply</p>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}

/** A LinkedIn post: identity, text cut at "more", media, a poll or a PDF document. */
function LinkedInPost({ item, target }: { item: PreviewItem; target: DraftTarget | null }) {
  const { account, publication } = item
  const post = publication.serialized.posts[0]
  const options = publication.target.options
  return (
    <article className="bg-[#1b1f23] p-3 text-neutral-100">
      <header className="flex items-center gap-2">
        <Avatar account={account} size="size-12" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {account.displayName ?? account.handle ?? 'LinkedIn'}
          </p>
          <p className="text-[11px] text-neutral-400">
            now · {options?.visibility === 'CONNECTIONS' ? 'Connections only' : 'Anyone'}
          </p>
        </div>
      </header>
      <div className="mt-2">
        <Truncated channel="linkedin" text={post?.caption ?? ''} />
      </div>
      {post ? <Media assetIds={post.assetIds} channel="linkedin" videos={post.videos} /> : null}
      {publication.target.poll ? (
        <Poll channel="linkedin" poll={publication.target.poll} question={options?.pollQuestion} />
      ) : null}
      {options?.documentAssetId ? (
        <div className="mt-2">
          <PdfCarousel assetId={options.documentAssetId} />
        </div>
      ) : null}
      {target?.kind === 'quote' ? <TargetCard target={target} /> : null}
      {options?.firstComment ? (
        <div className="mt-3 rounded-lg bg-white/5 p-2 text-xs text-neutral-300">
          <span className="text-neutral-400">First comment: </span>
          {options.firstComment}
        </div>
      ) : null}
    </article>
  )
}

/** The article body comes exclusively from articleContent's escaped allowlisted serializer. */
function ArticlePreview({ item }: { item: PreviewItem }) {
  const options = item.publication.target.options!
  const html = (options.articleHtml ?? '').replace(
    /data-asset-id="([a-z0-9-]+)"/g,
    (_, id: string) => `src="${assetContentUrl(id)}"`
  )
  return (
    <article className="p-4" data-testid="article-preview">
      {options.articleCoverAssetId ? (
        <img
          alt="Article cover"
          className="mb-4 aspect-video rounded-lg object-cover"
          src={assetContentUrl(options.articleCoverAssetId)}
        />
      ) : null}
      <h1 className="mb-3 text-2xl font-bold">{options.articleTitle}</h1>
      <p className="mb-4 text-sm text-neutral-400">
        {item.account.displayName ?? item.account.handle}
      </p>
      <div
        className="prose prose-invert max-w-none [&_p]:mb-3 [&_h1]:text-2xl [&_h2]:text-xl [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-5 [&_a]:text-sky-400 [&_img]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  )
}
