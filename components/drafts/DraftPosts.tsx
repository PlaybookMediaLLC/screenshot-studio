'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Pill, type PillTone } from '@/components/platform-ui'
import { Button } from '@/components/ui/button'
import { type DraftPostWire, draftsApi } from '@/lib/content-drafts/client'
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
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Posts from this draft
      </h2>
      <ul className="divide-y divide-foreground/[0.05] rounded-xl border border-foreground/[0.06]">
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
                  <p className="flex items-center gap-1.5 text-sm text-foreground">
                    {channel ? <ChannelIcon channel={channel} /> : null}
                    {channel ? CHANNEL_META[channel].label : post.platform} ·{' '}
                    <LocalTime value={post.scheduledFor} />
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{post.caption}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Pill tone={POST_TONES[post.status] ?? 'gray'}>{post.status}</Pill>
                  {post.url ? (
                    <a
                      className="text-xs text-sky-700 dark:text-sky-300 hover:text-sky-700 dark:hover:text-sky-200"
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
              {post.replies > 0 && post.status !== 'PUBLISHED' ? (
                <p className="text-xs text-muted-foreground">
                  A thread: this post and {post.replies} replies.
                </p>
              ) : null}
              {stopped ? (
                <p className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300" role="status">
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
                <div className="flex flex-wrap items-center gap-3 text-xs text-foreground/65">
                  {counts.length > 0 ? (
                    counts.map(([key, label]) => (
                      <span data-testid={`metric-${key}`} key={key}>
                        <span className="text-foreground">{post.metrics?.[key]?.toLocaleString()}</span>{' '}
                        {label}
                      </span>
                    ))
                  ) : (
                    <span>No engagement read yet.</span>
                  )}
                  <Button variant="custom" size={null}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-50"
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
            </li>
          )
        })}
      </ul>
    </section>
  )
}
