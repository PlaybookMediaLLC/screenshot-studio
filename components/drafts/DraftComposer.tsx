'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { toast } from 'sonner'
import type { Value } from '@shots/platejs-editor/platejs'
import { ViewIcon } from 'hugeicons-react'
import { Pill, type PillTone } from '@/components/platform-ui'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { DraftRequestError, type DraftPostWire, draftsApi } from '@/lib/content-drafts/client'
import {
  type DraftDiscussions,
  mergeDiscussions,
  readDiscussions,
} from '@/lib/content-drafts/discussions'
import { renderBlockImages } from '@/lib/content-drafts/render-blocks'
import {
  CHANNEL_IMAGE_LIMITS,
  type DraftChannel,
  draftPlainText,
  renderableBlockCount,
  type SerializedCaption,
  serializeDraft,
} from '@/lib/content-drafts/serialize'
import { assetContentUrl, platformEditorServices } from '@/lib/editor/services'
import { cn } from '@/lib/utils'
import { CHANNEL_META, ChannelIcon } from './channel-meta'
import { useShowInRail } from './DraftsRail'
import { POST_COLUMN } from './layout'
import { useTRPCClient } from '@/lib/trpc/react'
import type { DraftEditorUser } from './DraftEditor'

// The editor kit is heavy; only this route loads it, after the page renders.
const DraftEditor = dynamic(() => import('./DraftEditor'), {
  loading: () => <div className="min-h-[420px] p-6 text-sm text-neutral-500">Loading editor…</div>,
  ssr: false,
})

export type ComposerChannel = { channel: DraftChannel; id: string; name: string }

export type ComposerDraft = {
  assetIds: string[]
  body: Record<string, unknown>[]
  channelConnectionIds: string[]
  discussions: Record<string, unknown>
  id: string
  status: 'draft' | 'scheduled' | 'archived'
  title: string
  version: number
}

type SaveState = 'saved' | 'saving' | 'unsaved' | 'error'

const AUTOSAVE_DELAY_MS = 800

const POST_TONES: Partial<Record<DraftPostWire['status'], PillTone>> = {
  CANCELLED: 'gray',
  FAILED: 'red',
  PROCESSING: 'blue',
  PUBLISHED: 'green',
  SCHEDULED: 'purple',
  UNKNOWN_DELIVERY: 'yellow',
}

function defaultScheduleTime(): string {
  const at = new Date()
  at.setDate(at.getDate() + 1)
  at.setHours(9, 0, 0, 0)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T09:00`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

/**
 * The content draft composer. The draft reads as the post it becomes: the
 * author above the text, a counter per channel below it, the channels and
 * Schedule in the top bar, and a preview of each channel's post on demand.
 * Autosave is keyed on the draft's version.
 */
export function DraftComposer({
  aiEnabled,
  author,
  canEdit,
  canSchedule,
  channels,
  collabUrl,
  draft,
  posts: initialPosts,
  user,
}: {
  aiEnabled: boolean
  /** Who the post reads as from: the workspace. */
  author: string
  /** The collaboration server, when real-time co-editing is configured. */
  collabUrl: string | null
  canEdit: boolean
  canSchedule: boolean
  channels: ComposerChannel[]
  draft: ComposerDraft
  posts: DraftPostWire[]
  user: DraftEditorUser
}) {
  const trpcClient = useTRPCClient()
  const showInRail = useShowInRail()
  const services = React.useMemo(
    () => platformEditorServices(trpcClient, aiEnabled),
    [trpcClient, aiEnabled]
  )
  const [title, setTitle] = React.useState(draft.title)
  const [value, setValue] = React.useState<Value>(draft.body as Value)
  const [editorState, setEditorState] = React.useState({ key: 0, value: draft.body as Value })
  const [status, setStatus] = React.useState(draft.status)
  const [selected, setSelected] = React.useState(() =>
    draft.channelConnectionIds.filter((id) => channels.some((channel) => channel.id === id))
  )
  const [scheduledFor, setScheduledFor] = React.useState(defaultScheduleTime)
  const [posts, setPosts] = React.useState(initialPosts)
  const [saveState, setSaveState] = React.useState<SaveState>('saved')
  const [scheduling, setScheduling] = React.useState(false)
  const [scheduleOpen, setScheduleOpen] = React.useState(false)
  const [previewing, setPreviewing] = React.useState(false)
  const version = React.useRef(draft.version)
  const editorArea = React.useRef<HTMLDivElement>(null)
  const initialDiscussions = React.useMemo(
    () => readDiscussions(draft.discussions),
    [draft.discussions]
  )
  const discussions = React.useRef(initialDiscussions)
  const latest = React.useRef({ selected, title, value })
  latest.current = { selected, title, value }
  const inFlight = React.useRef<Promise<void> | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const collaboration = React.useMemo(
    () => (collabUrl ? { draftId: draft.id, url: collabUrl } : null),
    [collabUrl, draft.id]
  )

  const reloadLatest = React.useCallback(async () => {
    const fresh = await draftsApi.get(draft.id)
    version.current = fresh.version
    setTitle(fresh.title)
    setValue(fresh.body as Value)
    setStatus(fresh.status)
    setEditorState((state) => ({ key: state.key + 1, value: fresh.body as Value }))
  }, [draft.id])

  const save = React.useCallback(async (): Promise<void> => {
    if (!canEdit) return
    if (inFlight.current) await inFlight.current
    const { selected: channelIds, title: nextTitle, value: nextValue } = latest.current
    const run = (async () => {
      setSaveState('saving')
      try {
        const saved = await draftsApi.save(draft.id, {
          assetIds: serializeDraft(nextValue, 'linkedin').assetIds,
          baseVersion: version.current,
          body: nextValue,
          channelConnectionIds: channelIds,
          discussions: discussions.current,
          plainText: draftPlainText(nextValue),
          title: nextTitle,
        })
        version.current = saved.version
        setStatus(saved.status)
        setSaveState('saved')
        showInRail({
          excerpt: draftPlainText(nextValue).slice(0, 160),
          id: draft.id,
          status: saved.status,
          title: nextTitle,
          updatedAt: new Date().toISOString(),
        })
      } catch (error) {
        if (error instanceof DraftRequestError && error.status === 409 && collaboration) {
          // In a live session every editor holds the same content: another
          // editor's autosave moved the version, so save again on top of it,
          // keeping the threads they saved as well as ours.
          const fresh = await draftsApi.get(draft.id)
          version.current = fresh.version
          discussions.current = mergeDiscussions(
            discussions.current,
            readDiscussions(fresh.discussions)
          )
          inFlight.current = null
          await save()
          return
        }
        if (error instanceof DraftRequestError && error.status === 409) {
          // Someone saved a newer version: show it rather than overwrite it.
          await reloadLatest()
          setSaveState('saved')
          toast.info('This draft was changed elsewhere. Showing the latest version.')
          return
        }
        setSaveState('error')
        toast.error(message(error))
      }
    })()
    inFlight.current = run
    await run
    inFlight.current = null
  }, [canEdit, collaboration, draft.id, reloadLatest, showInRail])

  const scheduleSave = React.useCallback(() => {
    if (!canEdit) return
    setSaveState('unsaved')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS)
  }, [canEdit, save])

  const onDiscussionsChange = React.useCallback(
    (next: DraftDiscussions) => {
      discussions.current = next
      scheduleSave()
    },
    [scheduleSave]
  )

  const flush = React.useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    await save()
  }, [save])

  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  // Tables and math blocks are rendered to images when the draft is scheduled.
  const pendingBlocks: string[] = Array.from({ length: renderableBlockCount(value) }, () => '')
  const previews = channels
    .filter((channel) => selected.includes(channel.id))
    .map((channel) => ({
      ...channel,
      result: serializeDraft(value, channel.channel, pendingBlocks),
    }))
  const blocked = previews.length === 0 || previews.some(({ result }) => result.errors.length > 0)
  const degraded = previews.filter(({ result }) => result.degradations.length > 0)

  const refreshPosts = async () => setPosts((await draftsApi.posts(draft.id)).posts)

  const schedule = async () => {
    setScheduling(true)
    try {
      await flush()
      const blockImages =
        renderableBlockCount(value) > 0 && editorArea.current && services.uploadFile
          ? await renderBlockImages(editorArea.current, services.uploadFile)
          : []
      const result = await draftsApi.schedule(draft.id, {
        blockImages,
        channelConnectionIds: selected,
        scheduledFor: new Date(scheduledFor).toISOString(),
        version: version.current,
      })
      version.current = result.draft.version
      setStatus(result.draft.status)
      setScheduleOpen(false)
      toast.success(
        result.created
          ? `Scheduled ${result.posts.length} post${result.posts.length === 1 ? '' : 's'}.`
          : 'Already scheduled.'
      )
      await refreshPosts()
    } catch (error) {
      toast.error(message(error))
    } finally {
      setScheduling(false)
    }
  }

  const cancelPost = async (postId: string) => {
    try {
      await trpcClient.scheduledPost.cancel.mutate({ scheduledPostId: postId })
      await refreshPosts()
      toast.success('Post cancelled.')
    } catch (error) {
      toast.error(message(error))
    }
  }

  const toggleChannel = (id: string, on: boolean) => {
    setSelected((current) => (on ? [...current, id] : current.filter((item) => item !== id)))
    scheduleSave()
  }

  const saveLabel = { error: 'Not saved', saved: 'Saved', saving: 'Saving…', unsaved: 'Editing…' }[
    saveState
  ]
  const live = posts.filter((post) => post.status === 'SCHEDULED' || post.status === 'PROCESSING')
  const handles = [...new Set(previews.map(({ channel }) => CHANNEL_META[channel].label))].join(
    ' · '
  )

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[#111111]/90 px-4 backdrop-blur">
        <Link
          aria-label="All drafts"
          className="text-neutral-500 hover:text-white md:hidden"
          href="/drafts"
        >
          ←
        </Link>
        <input
          aria-label="Draft title"
          className="min-w-0 max-w-64 flex-1 truncate bg-transparent text-sm text-neutral-300 outline-none placeholder:text-neutral-600 focus:text-white"
          disabled={!canEdit}
          maxLength={200}
          onChange={(event) => {
            setTitle(event.target.value)
            scheduleSave()
          }}
          placeholder="Untitled draft"
          value={title}
        />
        {canSchedule && channels.length > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                aria-label="Channels"
                className="flex h-7 items-center gap-1.5 rounded-full border border-white/[0.08] px-2.5 text-xs text-neutral-300 hover:border-white/20 hover:text-white"
                type="button"
              >
                {previews.length === 0
                  ? 'Choose channels'
                  : previews.map(({ channel, id }) => <ChannelIcon channel={channel} key={id} />)}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-2">
              <ChannelToggles channels={channels} onToggle={toggleChannel} selected={selected} />
            </PopoverContent>
          </Popover>
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-neutral-500" data-testid="save-state">
            {saveLabel}
          </span>
          {status === 'scheduled' ? <Pill tone="green">Scheduled</Pill> : null}
          {previews.length > 0 ? (
            <Button onClick={() => setPreviewing(true)} size="sm" variant="ghost">
              <ViewIcon aria-hidden className="size-4" />
              Preview
            </Button>
          ) : null}
          {canSchedule ? (
            <Button
              disabled={channels.length === 0}
              onClick={() => setScheduleOpen(true)}
              size="sm"
              title={
                channels.length === 0 ? 'Connect a channel in workspace settings first.' : undefined
              }
            >
              {status === 'scheduled' ? 'Reschedule' : 'Schedule'}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex-1">
        <div className="relative" ref={editorArea}>
          <DraftEditor
            collaboration={collaboration}
            postHeader={(number) => (
              // The draft reads as the post: who posts it, then the text.
              <PostHeader
                author={author}
                handles={handles}
                number={number}
                xLength={
                  previews.find(({ channel }) => channel === 'x')?.result.posts[number - 1]?.length
                }
              />
            )}
            initialDiscussions={initialDiscussions}
            initialValue={editorState.value}
            key={editorState.key}
            onChange={(next) => {
              setValue(next)
              scheduleSave()
            }}
            onDiscussionsChange={onDiscussionsChange}
            readOnly={!canEdit}
            services={services}
            title={title}
            user={user}
          />
        </div>
        {previews.length > 0 ? (
          <div className={cn('mb-10 flex flex-wrap justify-end gap-4', POST_COLUMN)}>
            {previews.map(({ channel, id, result }) => (
              <CharacterCount channel={channel} key={id} result={result} testId />
            ))}
          </div>
        ) : null}
        {posts.length > 0 ? (
          <section className={cn('mb-40', POST_COLUMN)}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
              Posts from this draft
            </h2>
            <ul className="divide-y divide-white/[0.05] rounded-xl border border-white/[0.06]">
              {posts.map((post) => (
                <li
                  className="flex items-center justify-between gap-4 px-4 py-3"
                  data-testid="draft-post"
                  key={post.id}
                >
                  <div className="min-w-0">
                    <p className="text-sm text-white">
                      {post.platform} · {new Date(post.scheduledFor).toLocaleString()}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-neutral-500">{post.caption}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Pill tone={POST_TONES[post.status] ?? 'gray'}>{post.status}</Pill>
                    {canSchedule && (post.status === 'SCHEDULED' || post.status === 'DRAFT') ? (
                      <Button onClick={() => void cancelPost(post.id)} size="sm" variant="outline">
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <Dialog onOpenChange={setScheduleOpen} open={scheduleOpen}>
        <DialogContent className="max-w-md gap-5">
          <DialogHeader>
            <DialogTitle>{status === 'scheduled' ? 'Reschedule' : 'Schedule'}</DialogTitle>
            <DialogDescription>
              All times in {Intl.DateTimeFormat().resolvedOptions().timeZone.replace('_', ' ')}.
              {live.length > 0 ? ' Its queued posts are replaced.' : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {quickTimes().map((option) => (
                <button
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors',
                    scheduledFor === option.value
                      ? 'border-sky-400/60 bg-sky-400/10 text-white'
                      : 'border-white/[0.08] text-neutral-400 hover:text-white'
                  )}
                  key={option.label}
                  onClick={() => setScheduledFor(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Input
              aria-label="Schedule time"
              onChange={(event) => setScheduledFor(event.target.value)}
              type="datetime-local"
              value={scheduledFor}
            />
          </div>
          <ChannelToggles
            channels={channels}
            onToggle={toggleChannel}
            results={new Map(previews.map(({ id, result }) => [id, result]))}
            selected={selected}
          />
          {degraded.length > 0 ? (
            <p className="text-xs text-amber-300" role="alert">
              Some content changes when posted:{' '}
              {degraded
                .map(
                  ({ channel, result }) =>
                    `${CHANNEL_META[channel].label}: ${result.degradations.map((item) => item.message).join(' ')}`
                )
                .join(' ')}
            </p>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setScheduleOpen(false)} variant="ghost">
              Keep editing
            </Button>
            <Button disabled={blocked || scheduling} onClick={() => void schedule()}>
              {scheduling ? 'Scheduling…' : degraded.length > 0 ? 'Schedule anyway' : 'Schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet onOpenChange={setPreviewing} open={previewing}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md" side="right">
          <SheetHeader>
            <SheetTitle>Preview</SheetTitle>
            <SheetDescription>Each post as the channel shows it.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 p-4">
            {previews.map(({ channel, id, name, result }) => (
              <PostPreview
                author={author}
                channel={channel}
                handle={name}
                key={id}
                result={result}
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

/** A post's header in the thread: avatar, author, channels, and its number. */
function PostHeader({
  author,
  handles,
  number,
  xLength,
}: {
  author: string
  handles: string
  number: number
  /** The post's length on X, where each post has its own limit. */
  xLength?: number
}) {
  return (
    <div className="mb-1 flex items-center gap-3" data-testid="post-header">
      <span
        aria-hidden
        className="relative z-[1] -ml-12 hidden size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500/40 to-violet-500/40 text-sm font-medium text-white ring-4 ring-[#111111] sm:flex"
        data-post-avatar
      >
        {author.slice(0, 1).toUpperCase()}
      </span>
      <p className="min-w-0 flex-1 truncate text-sm">
        <span className="font-medium text-white">{author}</span>
        {handles ? <span className="ml-1.5 text-neutral-500">{handles}</span> : null}
      </p>
      {number > 1 || xLength !== undefined ? (
        <span className="flex shrink-0 items-center gap-2 text-xs text-neutral-500">
          {xLength !== undefined ? (
            <span className={xLength > 280 ? 'text-red-400' : undefined}>{xLength} / 280</span>
          ) : null}
          <span>#{number}</span>
        </span>
      ) : null}
    </div>
  )
}

/** Quick picks for the schedule time, as `datetime-local` values. */
function quickTimes(): { label: string; value: string }[] {
  const at = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  const inAnHour = new Date(Date.now() + 60 * 60_000)
  inAnHour.setMinutes(Math.ceil(inAnHour.getMinutes() / 15) * 15, 0, 0)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)
  const monday = new Date()
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7))
  monday.setHours(9, 0, 0, 0)
  const options = [
    { label: 'In an hour', value: at(inAnHour) },
    { label: 'Tomorrow 9:00', value: at(tomorrow) },
    { label: 'Monday 9:00', value: at(monday) },
  ]
  // On a Sunday, tomorrow is Monday: offer it once.
  return options.filter(
    (option, index) => options.findIndex((o) => o.value === option.value) === index
  )
}

/** One switch per connected channel; with results, each one's limits and warnings. */
function ChannelToggles({
  channels,
  onToggle,
  results,
  selected,
}: {
  channels: ComposerChannel[]
  onToggle: (id: string, on: boolean) => void
  results?: Map<string, SerializedCaption>
  selected: string[]
}) {
  return (
    <ul className="flex flex-col gap-1">
      {channels.map(({ channel, id, name }) => {
        const result = results?.get(id)
        return (
          <li className="rounded-lg px-2 py-1.5 hover:bg-white/[0.03]" key={id}>
            <label className="flex cursor-pointer items-center gap-3 text-sm text-neutral-200">
              <ChannelIcon channel={channel} className="size-4 text-neutral-400" />
              <span className="min-w-0 flex-1 truncate">
                {CHANNEL_META[channel].label}
                <span className="ml-1.5 text-neutral-500">{name}</span>
              </span>
              <input
                aria-label={`${channel} · ${name}`}
                checked={selected.includes(id)}
                className="relative h-5 w-8 shrink-0 cursor-pointer appearance-none rounded-full bg-white/15 outline-none transition-colors before:absolute before:top-[3px] before:left-[3px] before:size-3.5 before:rounded-full before:bg-white before:transition-transform checked:bg-sky-500 checked:before:translate-x-3 focus-visible:ring-2 focus-visible:ring-sky-400/50"
                onChange={(event) => onToggle(id, event.target.checked)}
                type="checkbox"
              />
            </label>
            {result ? (
              <div className="mt-1 flex flex-col gap-0.5 pl-7">
                <CharacterCount channel={channel} result={result} />
                {result.errors.map((error) => (
                  <p className="text-xs text-red-400" key={error} role="alert">
                    {error}
                  </p>
                ))}
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/** A ring that fills toward the channel's limit, with the count beside it. */
function CharacterCount({
  channel,
  result,
  testId = false,
}: {
  channel: DraftChannel
  result: SerializedCaption
  /** The one counter tests read: the one under the editor. */
  testId?: boolean
}) {
  const over = result.length > result.limit
  const share = Math.min(result.length / result.limit, 1)
  const circumference = 2 * Math.PI * 7
  return (
    <span className="flex items-center gap-1.5 text-xs text-neutral-500">
      <ChannelIcon channel={channel} className="size-3.5" />
      <svg aria-hidden className="size-4 -rotate-90" viewBox="0 0 18 18">
        <circle className="stroke-white/10" cx="9" cy="9" fill="none" r="7" strokeWidth="2" />
        <circle
          className={over ? 'stroke-red-400' : share > 0.9 ? 'stroke-amber-300' : 'stroke-sky-400'}
          cx="9"
          cy="9"
          fill="none"
          r="7"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share)}
          strokeLinecap="round"
          strokeWidth="2"
        />
      </svg>
      <span
        className={over ? 'text-red-400' : undefined}
        data-testid={testId ? `counter-${channel}` : undefined}
      >
        {result.length} / {result.limit}
      </span>
    </span>
  )
}

/** The post as its channel lays it out: author, text, images, and what changes. */
function PostPreview({
  author,
  channel,
  handle,
  result,
}: {
  author: string
  channel: DraftChannel
  handle: string
  result: SerializedCaption
}) {
  return (
    <article
      className="rounded-xl border border-white/[0.08] bg-black/30 p-4"
      data-testid={`preview-${channel}`}
    >
      <p className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        <ChannelIcon channel={channel} />
        {CHANNEL_META[channel].label}
      </p>
      {(result.posts.length > 0 ? result.posts : [{ assetIds: [], caption: '' }]).map(
        (post, index, posts) => (
          <div className="relative flex gap-3 pb-4 last:pb-0" key={index}>
            {index < posts.length - 1 ? (
              // The thread line, from this avatar down to the next.
              <span aria-hidden className="absolute top-10 bottom-0 left-[18px] w-px bg-white/10" />
            ) : null}
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500/40 to-violet-500/40 text-sm text-white"
            >
              {author.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <span className="font-medium text-white">{author}</span>
                <span className="ml-1.5 text-neutral-500">{handle}</span>
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-200">
                {post.caption || ' '}
              </p>
              {post.assetIds.length > 0 ? (
                <div
                  className={cn(
                    'mt-3 grid gap-1 overflow-hidden rounded-xl',
                    post.assetIds.length > 1 && 'grid-cols-2'
                  )}
                >
                  {post.assetIds.slice(0, CHANNEL_IMAGE_LIMITS[channel]).map((assetId) => (
                    // biome-ignore lint/performance/noImgElement: signed asset redirects
                    <img
                      alt=""
                      className="aspect-video w-full bg-white/5 object-cover"
                      key={assetId}
                      src={assetContentUrl(assetId)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )
      )}
      <div className="mt-3 flex flex-col gap-1 border-t border-white/[0.06] pt-3">
        <CharacterCount channel={channel} result={result} />
        {result.errors.map((error) => (
          <p className="text-xs text-red-400" key={error} role="alert">
            {error}
          </p>
        ))}
        {result.degradations.map((item) => (
          <p className="text-xs text-amber-300" key={item.kind}>
            {item.message}
          </p>
        ))}
      </div>
    </article>
  )
}
