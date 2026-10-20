'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { getErrorMessage } from '@/components/workspace/settings-client'
import {
  editResetsApproval,
  type PostConflictChoice,
  type PostFields,
  postFields,
  postLength,
  resolvePostConflict,
  samePostFields,
  type SaveState,
  saveStateFor,
} from '@/lib/launch/post-edit'
import type { CampaignPostStatus } from '@/lib/tenant/campaign-status'
import { useTRPCClient } from '@/lib/trpc/react'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'

/** Autosave waits this long after the last keystroke. */
const AUTOSAVE_MS = 800

/** The live per-channel length, counted the way the copy guard counts it. */
export function LengthCounter({
  callToAction,
  copy,
  limit,
}: {
  callToAction: string | null
  copy: string
  limit: number
}) {
  const length = postLength(copy, callToAction)
  return (
    <p
      className={cn(
        'ml-auto text-xs tabular-nums',
        length > limit ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground'
      )}
    >
      {length} / {limit} characters
    </p>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  const label = state.kind === 'saving' ? 'Saving…' : state.kind === 'saved' ? 'Saved' : ''
  return (
    <span aria-live="polite" className="text-xs text-muted-foreground" role="status">
      {label}
    </span>
  )
}

/**
 * Inline edit of a post's title, copy, and call to action. Edits autosave
 * after a pause and on blur, against the copy they were made from: if the
 * post changed elsewhere, both versions show and the author picks one. Copy
 * with a prohibited term is refused with the terms and reasons, and the typed
 * text is never dropped.
 */
export function PostEditor({
  campaignId,
  limit,
  onDone,
  post,
}: {
  campaignId: string
  limit: number | null
  onDone: () => void
  post: {
    callToAction: string | null
    copy: string
    id: string
    status: CampaignPostStatus
    title: string | null
  }
}) {
  const trpcClient = useTRPCClient()
  const router = useRouter()
  const id = useId()
  const [draft, setDraft] = useState(() => postFields(post))
  const [state, setState] = useState<SaveState>({ kind: 'idle' })
  const latest = useRef(draft)
  // What the backend holds, and the copy the next save is made against.
  const saved = useRef(postFields(post))
  const expectedCopy = useRef(post.copy)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const inFlight = useRef<Promise<void> | null>(null)
  const pending = useRef(false)
  // A conflict waits for the author; nothing saves over it.
  const conflicted = useRef(false)

  // Leaving with an autosave still waiting saves it rather than dropping it.
  const flush = useRef<() => Promise<void>>(undefined)
  useEffect(
    () => () => {
      if (timer.current !== undefined) void flush.current?.()
    },
    []
  )

  function save(): Promise<void> {
    clearTimeout(timer.current)
    timer.current = undefined
    if (inFlight.current) {
      pending.current = true
      return inFlight.current
    }
    const fields = latest.current
    if (conflicted.current || samePostFields(fields, saved.current)) return Promise.resolve()
    if (!fields.copy.trim()) {
      setState({ kind: 'failed', message: 'The post needs copy before it can be saved.' })
      return Promise.resolve()
    }
    setState({ kind: 'saving' })
    inFlight.current = (async () => {
      try {
        const result = await trpcClient.campaign.updatePost.mutate({
          campaignId,
          postId: post.id,
          ...fields,
          expectedCopy: expectedCopy.current,
        })
        if (result.outcome === 'saved') {
          saved.current = fields
          expectedCopy.current = result.post.copy
          // The card behind the editor, its status, and its actions catch up.
          router.refresh()
        }
        if (result.outcome === 'stale') conflicted.current = true
        setState(saveStateFor(result))
      } catch (error) {
        setState({ kind: 'failed', message: getErrorMessage(error) })
      } finally {
        inFlight.current = null
      }
      // Edits made while this save was in flight.
      if (pending.current) {
        pending.current = false
        await save()
      }
    })()
    return inFlight.current
  }

  flush.current = save

  function change(field: keyof PostFields, value: string) {
    const next = { ...latest.current, [field]: value }
    latest.current = next
    setDraft(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), AUTOSAVE_MS)
  }

  function resolve(choice: PostConflictChoice) {
    if (state.kind !== 'stale') return
    const resolved = resolvePostConflict(choice, latest.current, state.theirs)
    latest.current = resolved.draft
    setDraft(resolved.draft)
    saved.current = postFields(state.theirs)
    expectedCopy.current = resolved.expectedCopy
    conflicted.current = false
    setState({ kind: 'idle' })
    if (choice === 'keep') void save()
    else router.refresh()
  }

  async function done() {
    await save()
    if (!conflicted.current && samePostFields(latest.current, saved.current)) onDone()
  }

  const fieldClassName =
    'rounded-lg border-foreground/[0.08] bg-foreground/[0.03] text-sm text-foreground focus-visible:border-foreground/20'

  return (
    <div className="flex flex-col gap-3">
      {editResetsApproval(post.status) ? (
        <p
          className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
          role="note"
        >
          Editing sends this post back to draft. It needs approval again before it publishes.
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium text-foreground/65" htmlFor={`${id}-title`}>
          Title
        </Label>
        <Input
          className={cn('h-9', fieldClassName)}
          id={`${id}-title`}
          maxLength={200}
          onBlur={() => void save()}
          onChange={(event) => change('title', event.target.value)}
          value={draft.title}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium text-foreground/65" htmlFor={`${id}-copy`}>
          Copy
        </Label>
        <Textarea
          autoFocus
          className={cn('min-h-32 leading-6', fieldClassName)}
          id={`${id}-copy`}
          maxLength={10_000}
          onBlur={() => void save()}
          onChange={(event) => change('copy', event.target.value)}
          value={draft.copy}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium text-foreground/65" htmlFor={`${id}-cta`}>
          Call to action
        </Label>
        <Input
          className={cn('h-9', fieldClassName)}
          id={`${id}-cta`}
          maxLength={300}
          onBlur={() => void save()}
          onChange={(event) => change('callToAction', event.target.value)}
          value={draft.callToAction}
        />
      </div>
      {state.kind === 'stale' ? (
        <div
          className="flex flex-col gap-3 rounded-xl bg-amber-500/[0.06] px-4 py-3 ring-1 ring-amber-500/20"
          role="alert"
        >
          <div>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
              This post changed elsewhere
            </p>
            <p className="mt-0.5 text-xs text-foreground/65">
              Your text is not saved yet. Keep yours to replace theirs, or reload theirs and drop
              your edit.
            </p>
          </div>
          <div className="rounded-lg bg-foreground/[0.03] px-3 py-2 ring-1 ring-foreground/[0.06]">
            <p className="text-xs font-medium text-muted-foreground">Their version</p>
            {state.theirs.title ? (
              <p className="mt-1 text-sm font-medium text-foreground">{state.theirs.title}</p>
            ) : null}
            <p className="mt-1 text-sm whitespace-pre-wrap text-foreground">{state.theirs.copy}</p>
            {state.theirs.callToAction ? (
              <p className="mt-1 text-sm text-foreground/80">{state.theirs.callToAction}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-8 rounded-lg text-xs"
              onClick={() => resolve('keep')}
              size="sm"
              type="button"
            >
              Keep mine
            </Button>
            <Button
              className="h-8 rounded-lg text-xs"
              onClick={() => resolve('reload')}
              size="sm"
              type="button"
              variant="outline"
            >
              Reload theirs
            </Button>
          </div>
        </div>
      ) : null}
      {state.kind === 'prohibited' ? (
        <div className="rounded-xl bg-red-500/[0.06] px-4 py-3 ring-1 ring-red-500/20" role="alert">
          <p className="text-sm font-medium text-red-700 dark:text-red-300">
            Not saved: this post uses {state.matches.length === 1 ? 'a term' : 'terms'} your brand
            never uses
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-foreground">
            {state.matches.map((match) => (
              <li key={`${match.matchMode}:${match.term}`}>
                <span className="font-medium text-foreground">“{match.term}”</span>
                {match.reason ? (
                  <span className="text-foreground/65"> · {match.reason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {state.kind === 'failed' ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
          role="alert"
        >
          <span>Not saved: {state.message} Your text is kept.</span>
          <Button
            className="h-7 rounded-lg text-xs"
            onClick={() => void save()}
            size="sm"
            type="button"
            variant="outline"
          >
            Retry
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <SaveIndicator state={state} />
        {limit ? (
          <LengthCounter callToAction={draft.callToAction} copy={draft.copy} limit={limit} />
        ) : null}
        <Button
          className={cn('h-8 rounded-lg text-xs', limit ? '' : 'ml-auto')}
          onClick={() => void done()}
          size="sm"
          type="button"
          variant="outline"
        >
          Done editing
        </Button>
      </div>
    </div>
  )
}
