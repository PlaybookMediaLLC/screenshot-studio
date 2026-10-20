'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Pill, type PillTone } from '@/components/platform-ui'
import { Button } from '@/components/ui/button'
import { type DraftPostWire, draftsApi } from '@/lib/content-drafts/client'
import { writeApi } from '@/lib/write/client'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { channelForPlatform } from '@/lib/content-drafts/serialize'
import { cn } from '@/lib/utils'
import { CHANNEL_META, ChannelIcon } from './channel-meta'
import { POST_COLUMN } from './layout'
import { LocalTime } from './local-time'

const POST_TONES: Partial<Record<DraftPostWire['status'], PillTone>> = {
  CANCELLED: 'gray',
  FAILED: 'red',
  PROCESSING: 'blue',
  PUBLISHED: 'green',
  SCHEDULED: 'purple',
  UNKNOWN_DELIVERY: 'yellow',
}

/** What each status means to the person reading it. */
const STATUS_LABELS: Partial<Record<DraftPostWire['status'], string>> = {
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
  PROCESSING: 'Publishing',
  PUBLISHED: 'Published',
  SCHEDULED: 'Scheduled',
  UNKNOWN_DELIVERY: 'Outcome unknown',
}

/** The engagement counts the posts list shows, in order, with their labels. */
const METRICS: [string, string][] = [
  ['likes', 'likes'],
  ['reposts', 'reposts'],
  ['replies', 'replies'],
  ['impressions', 'views'],
]

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

/**
 * The posts a draft became: when and where each goes out, a link to it once
 * live with its engagement, a thread that stopped partway with the rest one
 * click away, and a queued post's cancel.
 */
export function DraftPosts({
  canSchedule,
  onCancel,
  onChange,
  posts,
}: {
  canSchedule: boolean
  onCancel: (postId: string) => Promise<void>
  /** Called with a post as the server now has it, or a new one. */
  onChange: (post: DraftPostWire) => void
  posts: DraftPostWire[]
}) {
  const [busy, setBusy] = React.useState<string | null>(null)
  const run = async (id: string, action: () => Promise<{ post: DraftPostWire }>, done: string) => {
    setBusy(id)
    try {
      onChange((await action()).post)
      toast.success(done)
    } catch (error) {
      toast.error(message(error))
    } finally {
      setBusy(null)
    }
  }
  if (posts.length === 0) return null
  return (
    <section className={cn('mb-10', POST_COLUMN)}>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
        Posts from this draft
      </h2>
      <ul className="divide-y divide-white/[0.05] rounded-xl border border-white/[0.06]">
        {posts.map((post) => {
          const channel = channelForPlatform(post.platform)
          const stopped =
            post.status === 'PUBLISHED' &&
            post.threadProgress.total > 0 &&
            post.threadProgress.posted < post.threadProgress.total
          const counts = METRICS.filter(([key]) => post.metrics?.[key] !== undefined)
          return (
            <li className="flex flex-col gap-2 px-4 py-3" data-testid="draft-post" key={post.id}>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm text-white">
                    {channel ? <ChannelIcon channel={channel} /> : null}
                    {channel ? CHANNEL_META[channel].label : post.platform} ·{' '}
                    <LocalTime value={post.scheduledFor} />
                  </p>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">{post.caption}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Pill tone={POST_TONES[post.status] ?? 'gray'}>{STATUS_LABELS[post.status] ?? post.status}</Pill>
                  {post.url ? (
                    <a
                      className="text-xs text-sky-300 hover:text-sky-200"
                      href={post.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      View post
                    </a>
                  ) : null}
                  {canSchedule && (post.status === 'SCHEDULED' || post.status === 'DRAFT') ? (
                    <Button onClick={() => void onCancel(post.id)} size="sm" variant="outline">
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
              {post.status === 'FAILED' ? (
                <p className="flex flex-wrap items-center gap-2 text-xs text-red-300" role="status">
                  This destination did not publish; the draft’s other posts are unaffected.
                  {canSchedule ? (
                    <Button
                      disabled={busy === post.id}
                      onClick={() => void run(post.id, () => writeApi.retryPost(post.id), 'Retrying this destination now.')}
                      size="sm"
                      variant="outline"
                    >
                      Retry this destination
                    </Button>
                  ) : null}
                </p>
              ) : null}
              {post.status === 'UNKNOWN_DELIVERY' ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-amber-300" role="status">
                  The platform did not confirm whether this went out. Check the account before doing
                  anything: retrying blindly could post twice.
                  {canSchedule ? (
                    <Reconcile
                      busy={busy === post.id}
                      onSettle={(live, url) =>
                        void run(
                          post.id,
                          () => writeApi.reconcilePost(post.id, { live, url: url || undefined }),
                          live ? 'Marked as published.' : 'Marked as not published; you can retry it now.'
                        )
                      }
                    />
                  ) : null}
                </div>
              ) : null}
              {post.replies > 0 && post.status !== 'PUBLISHED' ? (
                <p className="text-xs text-neutral-500">
                  A thread: this post and {post.replies} replies.
                </p>
              ) : null}
              {stopped ? (
                <p className="flex items-center gap-2 text-xs text-amber-300" role="status">
                  {post.threadProgress.posted} of {post.threadProgress.total} replies went out.
                  {canSchedule ? (
                    <Button
                      disabled={busy === post.id}
                      onClick={() =>
                        void run(
                          post.id,
                          () => draftsApi.resumeThread(post.id),
                          'Posting the rest.'
                        )
                      }
                      size="sm"
                      variant="outline"
                    >
                      Post the rest
                    </Button>
                  ) : null}
                </p>
              ) : null}
              {post.status === 'PUBLISHED' ? (
                <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
                  {counts.length > 0 ? (
                    counts.map(([key, label]) => (
                      <span data-testid={`metric-${key}`} key={key}>
                        <span className="text-white">{post.metrics?.[key]?.toLocaleString()}</span>{' '}
                        {label}
                      </span>
                    ))
                  ) : (
                    <span>No engagement read yet.</span>
                  )}
                  <Button variant="custom" size={null}
                    className="text-neutral-500 hover:text-white disabled:opacity-50"
                    disabled={busy === post.id}
                    onClick={() =>
                      void run(
                        post.id,
                        () => draftsApi.refreshMetrics(post.id),
                        'Engagement updated.'
                      )
                    }
                    type="button"
                  >
                    {post.metricsAt ? (
                      <>
                        Updated <LocalTime value={post.metricsAt} /> · Refresh
                      </>
                    ) : (
                      'Read engagement'
                    )}
                  </Button>
                </div>
              ) : null}
              {post.automations.length > 0 ? (
                <FollowUps
                  busy={busy === post.id}
                  onStop={
                    canSchedule && post.automations.some((item) => item.status === 'pending' && item.kind !== 'unretweet')
                      ? () =>
                          void run(
                            post.id,
                            () => writeApi.cancelAutomations(post.id),
                            'Follow-ups stopped. A repost already up is still removed on time.'
                          )
                      : undefined
                  }
                  post={post}
                />
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** What each follow-up is, as a person reads it. */
const FOLLOW_UP_LABELS: Record<DraftPostWire['automations'][number]['kind'], string> = {
  first_comment: 'First comment',
  plug: 'Auto-Plug reply',
  quote: 'Quote',
  repost_at_likes: 'Repost at likes',
  retweet: 'Auto-RT repost',
  unretweet: 'Remove the repost',
}

/** Where a follow-up is. */
const FOLLOW_UP_STATUS: Record<DraftPostWire['automations'][number]['status'], string> = {
  cancelled: 'stopped',
  done: 'done',
  expired: 'not reached in time',
  failed: 'failed',
  pending: 'waiting',
  skipped: 'skipped',
}

/** A live post's follow-ups and their receipts (RFC 042). */
function FollowUps({ busy, onStop, post }: { busy: boolean; onStop?: () => void; post: DraftPostWire }) {
  return (
    <div className="grid gap-1 text-xs" data-testid="follow-ups">
      <p className="flex items-center justify-between text-neutral-400">
        After it went live
        {onStop ? (
          <Button disabled={busy} onClick={onStop} size="sm" variant="outline">
            Stop follow-ups
          </Button>
        ) : null}
      </p>
      <ul className="grid gap-0.5">
        {post.automations.map((item) => (
          <li className="flex items-center gap-2 text-neutral-500" data-testid="follow-up" key={item.key}>
            <span className="text-neutral-300">{FOLLOW_UP_LABELS[item.kind]}</span>
            <LocalTime value={item.dueAt} />
            <span className={cn(item.status === 'failed' && 'text-red-300', item.status === 'done' && 'text-emerald-300')}>
              {FOLLOW_UP_STATUS[item.status]}
              {item.failureCode && item.status !== 'done' ? ` (${item.failureCode})` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Say what the platform shows for a post of unknown outcome. Nothing is sent to it. */
function Reconcile({ busy, onSettle }: { busy: boolean; onSettle: (live: boolean, url: string) => void }) {
  const [url, setUrl] = React.useState('')
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button disabled={busy} size="sm" variant="outline">
          I checked the account…
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-80 gap-2 p-3 text-sm">
        <p className="text-neutral-200">Is the post on the account?</p>
        <Input
          aria-label="The post's URL"
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Its URL, if it is live (optional)"
          value={url}
        />
        <div className="flex gap-2">
          <Button onClick={() => onSettle(true, url.trim())} size="sm">
            It is live
          </Button>
          <Button onClick={() => onSettle(false, '')} size="sm" variant="outline">
            It is not there
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
