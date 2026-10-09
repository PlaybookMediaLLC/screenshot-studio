'use client'

import type { CampaignPostStatus } from '@prisma/client'
import * as Tabs from '@radix-ui/react-tabs'
import { Copy01Icon } from 'hugeicons-react'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { RevisePanel } from '@/components/launch/RevisePanel'
import { Pill, type PillTone } from '@/components/platform-ui'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/components/workspace/settings-client'
import { CHANNEL_RULES } from '@/lib/launch/guards'
import {
  type CampaignApprovalDecision,
  canTransitionCampaignPost,
} from '@/lib/tenant/campaign-status'
import { useTRPCClient } from '@/lib/trpc/react'
import { cn } from '@/lib/utils'

export type CopyPost = {
  /** "G1 · Upgrade with one command", from the plan. */
  angle: string | null
  callToAction: string | null
  channel: string
  /** Spec claims the post relies on; `current` is false once the working spec says something else there. */
  claims: { current: boolean; ref: string; text: string }[]
  copy: string
  /** Written for an earlier plan version than the one the campaign works from now. */
  fromEarlierPlan: boolean
  id: string
  /** "Teaser", "Launch day", or "Follow-up". */
  phase: string | null
  reviewNote: string | null
  status: CampaignPostStatus
  title: string | null
}

export type CopyChannel = { label: string; role: string | null; value: string }

type Permissions = {
  aiConfigured: boolean
  campaignId: string
  canApprove: boolean
  canEdit: boolean
}

const POST_STATUS: Record<CampaignPostStatus, { label: string; tone: PillTone }> = {
  APPROVED: { label: 'Approved', tone: 'green' },
  DRAFT: { label: 'Draft', tone: 'gray' },
  NEEDS_CHANGES: { label: 'Changes requested', tone: 'yellow' },
  PUBLISHED: { label: 'Published', tone: 'green' },
  READY_FOR_REVIEW: { label: 'In review', tone: 'yellow' },
  REJECTED: { label: 'Rejected', tone: 'red' },
  SCHEDULED: { label: 'Scheduled', tone: 'blue' },
}

const DECISIONS: {
  decision: CampaignApprovalDecision
  label: string
  needsNote: boolean
  variant: 'default' | 'outline'
}[] = [
  { decision: 'submit', label: 'Submit for review', needsNote: false, variant: 'outline' },
  { decision: 'approve', label: 'Approve', needsNote: false, variant: 'default' },
  { decision: 'request_changes', label: 'Request changes', needsNote: true, variant: 'outline' },
  { decision: 'reject', label: 'Reject', needsNote: true, variant: 'outline' },
]

/** The review moves valid for the post's status and the reviewer's role; the server re-checks. */
function ReviewActions({ permissions, post }: { permissions: Permissions; post: CopyPost }) {
  const trpcClient = useTRPCClient()
  const router = useRouter()
  const noteId = useId()
  const [noting, setNoting] = useState<CampaignApprovalDecision | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const available = DECISIONS.filter(
    ({ decision }) =>
      canTransitionCampaignPost(decision, post.status) &&
      (decision === 'submit' ? permissions.canEdit : permissions.canApprove)
  )

  async function decide(decision: CampaignApprovalDecision, reviewNote?: string) {
    setBusy(true)
    setError(null)
    try {
      await trpcClient.campaign.decideApproval.mutate({
        campaignId: permissions.campaignId,
        decision,
        postIds: [post.id],
        ...(reviewNote ? { note: reviewNote } : {}),
      })
      setNoting(null)
      setNote('')
      router.refresh()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  const alert = error ? (
    <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
      {error}
    </div>
  ) : null

  if (noting) {
    return (
      <>
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void decide(noting, note.trim())
          }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <label className="text-xs font-medium text-neutral-400" htmlFor={noteId}>
              Review note
            </label>
            <span className="text-xs text-neutral-500">
              {noting === 'reject' ? 'Rejecting this post' : 'Requesting changes'}
            </span>
          </div>
          <textarea
            autoFocus
            className="min-h-20 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-white/20"
            id={noteId}
            maxLength={1_000}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              noting === 'reject'
                ? 'Why does this not work? The next draft learns from it.'
                : 'What should change? The next draft follows this note.'
            }
            value={note}
          />
          <div className="flex justify-end gap-2">
            <Button
              className="rounded-lg"
              disabled={busy}
              onClick={() => setNoting(null)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button className="rounded-lg" disabled={busy} size="sm" type="submit">
              {busy ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </form>
        {alert}
      </>
    )
  }

  return (
    <>
      {available.map(({ decision, label, needsNote, variant }) => (
        <Button
          className="h-8 rounded-lg text-xs"
          disabled={busy}
          key={decision}
          onClick={() => (needsNote ? setNoting(decision) : void decide(decision))}
          size="sm"
          type="button"
          variant={variant}
        >
          {label}
        </Button>
      ))}
      {alert}
    </>
  )
}

function CopyTextButton({ post }: { post: CopyPost }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        [post.title, post.copy, post.callToAction].filter(Boolean).join('\n\n')
      )
      toast.success('Copied to the clipboard')
    } catch {
      toast.error('Could not copy. Select the text and copy it instead.')
    }
  }
  return (
    <Button
      className="ml-auto h-8 gap-1.5 rounded-lg text-xs"
      onClick={() => void copy()}
      size="sm"
      type="button"
      variant="ghost"
    >
      <Copy01Icon size={14} />
      Copy text
    </Button>
  )
}

/** Sends every draft and every post sent back to review at once, across channels. */
function SubmitAll({ permissions, posts }: { permissions: Permissions; posts: CopyPost[] }) {
  const trpcClient = useTRPCClient()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const count = posts.filter((post) => canTransitionCampaignPost('submit', post.status)).length
  if (!permissions.canEdit || count === 0) return null

  async function submitAll() {
    setBusy(true)
    try {
      await trpcClient.campaign.decideApproval.mutate({
        campaignId: permissions.campaignId,
        decision: 'submit',
      })
      toast.success(`${count} ${count === 1 ? 'post' : 'posts'} sent for review`)
      router.refresh()
    } catch (requestError) {
      toast.error('The posts could not be sent for review', {
        description: getErrorMessage(requestError),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      className="rounded-lg"
      disabled={busy}
      onClick={() => void submitAll()}
      size="sm"
      type="button"
      variant="outline"
    >
      {busy ? 'Submitting…' : `Submit all ${count} for review`}
    </Button>
  )
}

function PostCard({ permissions, post }: { permissions: Permissions; post: CopyPost }) {
  const status = POST_STATUS[post.status]
  // Counted the way the copy guard counts it: copy plus call to action, as posted.
  const length = [post.copy, post.callToAction].filter(Boolean).join(' ').length
  const limit = post.channel === 'x' ? CHANNEL_RULES.x.bodyMax : null
  return (
    <article className="flex flex-col rounded-2xl bg-white/[0.015] ring-1 ring-white/[0.08]">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {post.phase ? <Pill>{post.phase}</Pill> : null}
          {post.angle ? <Pill tone="blue">{post.angle}</Pill> : null}
          {post.fromEarlierPlan ? <Pill>From an earlier plan</Pill> : null}
          <span className="ml-auto">
            <Pill tone={status.tone}>{status.label}</Pill>
          </span>
        </div>
        {post.title ? (
          <h3 className="text-base font-medium text-balance text-white">{post.title}</h3>
        ) : null}
        <p className="text-sm leading-6 whitespace-pre-wrap text-neutral-200">{post.copy}</p>
        {post.callToAction || limit ? (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            {post.callToAction ? (
              <p className="text-sm text-neutral-200">
                <span className="mr-2 text-xs font-medium text-neutral-500">Call to action</span>
                {post.callToAction}
              </p>
            ) : null}
            {limit ? (
              <p
                className={cn(
                  'ml-auto text-xs tabular-nums',
                  length > limit ? 'text-red-300' : 'text-neutral-500'
                )}
              >
                {length} / {limit} characters
              </p>
            ) : null}
          </div>
        ) : null}
        {post.reviewNote ? (
          <div className="rounded-xl bg-amber-500/[0.06] px-4 py-3 ring-1 ring-amber-500/20">
            <p className="text-xs font-medium text-amber-300">Reviewer note</p>
            <p className="mt-1 text-sm whitespace-pre-wrap text-neutral-200">{post.reviewNote}</p>
          </div>
        ) : null}
        {post.claims.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-neutral-500">Based on</p>
            <ul className="flex flex-wrap gap-1.5">
              {post.claims.map((claim, index) => (
                <li
                  className={cn(
                    'flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg px-2.5 py-1.5 text-xs ring-1',
                    claim.current
                      ? 'bg-white/[0.03] ring-white/[0.06]'
                      : 'bg-amber-500/[0.04] ring-amber-500/20'
                  )}
                  key={`${claim.ref}-${index}`}
                >
                  <code className="font-mono text-neutral-400">{claim.ref}</code>
                  <span className="text-neutral-300">{claim.text}</span>
                  {claim.current ? null : <Pill tone="yellow">Changed in the current spec</Pill>}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {/* Open forms and panels are divs and forms, and take the full row. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-5 py-3 [&>div]:basis-full [&>form]:basis-full">
        <ReviewActions permissions={permissions} post={post} />
        <CopyTextButton post={post} />
        {permissions.canEdit ? (
          <RevisePanel
            campaignId={permissions.campaignId}
            disabled={!permissions.aiConfigured}
            target={{ postId: post.id, type: 'post' }}
          />
        ) : null}
      </div>
    </article>
  )
}

/**
 * Posts by channel, each with its provenance (the spec claims it relies on)
 * and the review moves for its status. Inactive panels stay mounted so a
 * half-written note or revision survives switching channels.
 */
export function CopyBoard({
  channels,
  permissions,
  posts,
}: {
  channels: CopyChannel[]
  permissions: Permissions
  posts: CopyPost[]
}) {
  const initial =
    channels.find((channel) => posts.some((post) => post.channel === channel.value)) ?? channels[0]
  return (
    <Tabs.Root className="flex flex-col gap-5" defaultValue={initial?.value}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs.List
          aria-label="Channels"
          className="flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-lg bg-white/[0.03] p-0.5 ring-1 ring-white/[0.08]"
        >
          {channels.map((channel) => (
            <Tabs.Trigger
              className="flex shrink-0 items-center gap-2 rounded-md px-3 py-1 text-sm font-medium text-neutral-500 transition-colors outline-none hover:text-neutral-200 focus-visible:ring-2 focus-visible:ring-white/30 data-[state=active]:bg-white/[0.08] data-[state=active]:text-white"
              key={channel.value}
              value={channel.value}
            >
              {channel.label}{' '}
              <span className="text-xs text-neutral-500 tabular-nums">
                {posts.filter((post) => post.channel === channel.value).length}
              </span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <SubmitAll permissions={permissions} posts={posts} />
      </div>
      {channels.map((channel) => {
        const channelPosts = posts.filter((post) => post.channel === channel.value)
        return (
          <Tabs.Content
            className="flex flex-col gap-4 outline-none data-[state=inactive]:hidden"
            forceMount
            key={channel.value}
            value={channel.value}
          >
            {channel.role ? <p className="text-sm text-neutral-500">{channel.role}</p> : null}
            {channelPosts.length === 0 ? (
              <p className="rounded-2xl bg-white/[0.015] px-6 py-10 text-center text-sm text-neutral-500 ring-1 ring-white/[0.06]">
                No {channel.label} posts yet.
              </p>
            ) : (
              channelPosts.map((post) => (
                <PostCard key={post.id} permissions={permissions} post={post} />
              ))
            )}
          </Tabs.Content>
        )
      })}
    </Tabs.Root>
  )
}
