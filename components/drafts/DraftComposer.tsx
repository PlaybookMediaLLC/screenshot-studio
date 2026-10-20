'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { Value } from '@shots/platejs-editor/platejs'
import type { PlateEditor } from '@shots/platejs-editor/platejs/react'
import { ViewIcon } from 'hugeicons-react'
import type { z } from 'zod'
import type { linkCardSchema } from '@/lib/api/contracts/content-draft-platform'
import { Pill } from '@/components/platform-ui'
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
import {
  DraftRequestError,
  type DraftPostWire,
  type DraftWire,
  draftsApi,
} from '@/lib/content-drafts/client'
import {
  type DraftDiscussions,
  mergeDiscussions,
  readDiscussions,
} from '@/lib/content-drafts/discussions'
import { renderBlockImages } from '@/lib/content-drafts/render-blocks'
import { parseWhen } from '@/lib/content-drafts/when'
import {
  CHANNEL_IMAGE_LIMITS,
  type DraftChannel,
  draftPlainText,
  renderableBlockCount,
  type SerializedCaption,
  serializeDraft,
  THREAD_CHANNELS,
} from '@/lib/content-drafts/serialize'
import { assetContentUrl, platformEditorServices } from '@/lib/editor/services'
import { cn } from '@/lib/utils'
import { CHANNEL_META, ChannelIcon } from './channel-meta'
import { DraftPosts } from './DraftPosts'
import { useShowInRail } from './DraftsRail'
import {
  GuestComments,
  HistorySheet,
  type DraftReview,
  ReviewControls,
  ShareMenu,
} from './DraftTools'
import { XOptions, type XPostOptions, xOptionsForRequest } from './XOptions'
import { POST_COLUMN } from './layout'
import { useTRPCClient } from '@/lib/trpc/react'
import type { DraftEditorUser } from './DraftEditor'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { DeveloperId } from '@/components/settings/DeveloperId'
import { usePreferences } from '@/components/settings/PreferencesProvider'
import { DraftDetails } from './DraftDetails'
import { DraftSettingsDrawer } from './DraftSettingsDrawer'

// The editor kit is heavy; only this route loads it, after the page renders.
const DraftEditor = dynamic(() => import('./DraftEditor'), {
  loading: () => <div className="min-h-[420px] p-6 text-sm text-muted-foreground">Loading editor…</div>,
  ssr: false,
})

/** A connected account a draft can go to, as its platform shows it. */
export type ComposerChannel = {
  avatarUrl: string | null
  channel: DraftChannel
  handle: string | null
  /** Its health (RFC 043); only a connected account can be scheduled to. */
  health?: string
  id: string
  name: string
}

/** What to tell the writer about an account that cannot publish now. */
const UNHEALTHY: Record<string, string> = {
  expired: 'Access expired. Reconnect it in the social set settings.',
  permission_required: 'Needs one more step on the platform. Reconnect it in the social set settings.',
  reconnect_required: 'Needs reconnecting. Reconnect it in the social set settings.',
  removed: 'Removed from this social set.',
  revoked: 'Access was revoked. Reconnect it in the social set settings.',
}

export type ComposerDraft = {
  assetIds: string[]
  body: Record<string, unknown>[]
  channelConnectionIds: string[]
  /** Text a channel posts instead of the body's, by channel. */
  channelText: Record<string, string>
  discussions: Record<string, unknown>
  id: string
  status: 'draft' | 'scheduled' | 'archived'
  title: string
  version: number
  /** Copied from the social set when the draft was made (RFC 043). */
  engagement?: DraftWire['engagement']
  naturalPostingTime?: boolean
  plannedFor?: string | null
  primaryPlatform?: string | null
  socialSetId?: string | null
  tags?: string[]
} & DraftReview & { guestComments: DraftWire['guestComments'] }

type SaveState = 'saved' | 'saving' | 'unsaved' | 'error'

const AUTOSAVE_DELAY_MS = 800

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
  vocabulary,
  canEdit,
  canSchedule,
  channels,
  collabUrl,
  draft,
  posts: initialPosts,
  requireApproval,
  socialSet = null,
  user,
}: {
  aiEnabled: boolean
  /** The draft's social set: its name and scheduling time zone. */
  socialSet?: { id: string; name: string; timeZone: string } | null
  /** Who the post reads as from: the workspace. */
  author: string
  /** Handles and hashtags the workspace already writes. */
  vocabulary: { handles: string[]; hashtags: string[] }
  /** The collaboration server, when real-time co-editing is configured. */
  collabUrl: string | null
  canEdit: boolean
  canSchedule: boolean
  channels: ComposerChannel[]
  draft: ComposerDraft
  posts: DraftPostWire[]
  /** The workspace approves drafts before they are scheduled. */
  requireApproval: boolean
  user: DraftEditorUser
}) {
  const trpcClient = useTRPCClient()
  const showInRail = useShowInRail()
  const services = React.useMemo(
    () => platformEditorServices(trpcClient, aiEnabled),
    [trpcClient, aiEnabled]
  )
  const [title, setTitle] = React.useState(draft.title)
  const [review, setReview] = React.useState<DraftReview>(draft)
  const [guestComments, setGuestComments] = React.useState(draft.guestComments)
  // A new draft's X follow-ups start from its social set's defaults.
  const [xOptions, setXOptions] = React.useState<Record<string, XPostOptions>>(() => {
    const engagement = draft.engagement
    if (!engagement || (!engagement.autoRepost.enabled && !engagement.autoPlug.enabled)) return {}
    const actions: NonNullable<XPostOptions['autoActions']> = {
      ...(engagement.autoRepost.enabled ? { repostAtLikes: engagement.autoRepost.atLikes } : {}),
      ...(engagement.autoPlug.enabled
        ? { plugAtLikes: engagement.autoPlug.atLikes, plugText: engagement.autoPlug.text ?? '' }
        : {}),
    }
    return Object.fromEntries(
      channels.filter((channel) => channel.channel === 'x').map((channel) => [channel.id, { autoActions: actions }])
    )
  })
  const [naturalTime, setNaturalTime] = React.useState(draft.naturalPostingTime ?? false)
  const [details, setDetails] = React.useState({ plannedFor: draft.plannedFor ?? null, tags: draft.tags ?? [] })
  const textDirection = usePreferences().preferences?.textDirection ?? 'ltr'
  const [bestTimes, setBestTimes] = React.useState<{ at: string; reason: string }[]>([])
  const editorHandle = React.useRef<PlateEditor | null>(null)
  const onDraft = React.useCallback((next: DraftWire) => {
    setReview(next)
    setGuestComments(next.guestComments)
  }, [])
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
  const [whenText, setWhenText] = React.useState('')
  const [previewing, setPreviewing] = React.useState(false)
  const version = React.useRef(draft.version)
  const editorArea = React.useRef<HTMLDivElement>(null)
  // Changes made since the last save started.
  const dirty = React.useRef(false)
  const initialDiscussions = React.useMemo(
    () => readDiscussions(draft.discussions),
    [draft.discussions]
  )
  const discussions = React.useRef(initialDiscussions)
  const [channelText, setChannelText] = React.useState<Partial<Record<DraftChannel, string>>>(
    () => draft.channelText as Partial<Record<DraftChannel, string>>
  )
  const latest = React.useRef({ channelText, selected, title, value })
  latest.current = { channelText, selected, title, value }
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
    const {
      channelText: nextChannelText,
      selected: channelIds,
      title: nextTitle,
      value: nextValue,
    } = latest.current
    dirty.current = false
    const run = (async () => {
      setSaveState('saving')
      try {
        const saved = await draftsApi.save(draft.id, {
          assetIds: serializeDraft(nextValue, 'linkedin').assetIds,
          baseVersion: version.current,
          body: nextValue,
          channelConnectionIds: channelIds,
          channelText: nextChannelText,
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
    dirty.current = true
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

  // Saves only what changed: a save bumps the version, which would void an
  // approval given to the version as it stands.
  const flush = React.useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (dirty.current) await save()
    else if (inFlight.current) await inFlight.current
  }, [save])

  // Leaving the draft saves what is pending instead of dropping it, so
  // opening settings or another draft never loses the last keystrokes.
  const saveRef = React.useRef(save)
  saveRef.current = save
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      if (dirty.current) void saveRef.current()
    },
    []
  )
  React.useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty.current && !inFlight.current) return
      void saveRef.current()
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  // Tables and math blocks are rendered to images when the draft is scheduled.
  const pendingBlocks: string[] = Array.from({ length: renderableBlockCount(value) }, () => '')
  const previews = channels
    .filter((channel) => selected.includes(channel.id))
    .map((channel) => ({
      ...channel,
      result: serializeDraft(value, channel.channel, pendingBlocks, channelText[channel.channel]),
    }))
  const unhealthy = previews.filter(({ health }) => health && health !== 'connected')
  const blocked =
    previews.length === 0 || unhealthy.length > 0 || previews.some(({ result }) => result.errors.length > 0)
  const degraded = previews.filter(({ result }) => result.degradations.length > 0)

  const router = useRouter()
  // The posts here, and the rail's queue, which the server lists.
  const refreshPosts = async () => {
    setPosts((await draftsApi.posts(draft.id)).posts)
    router.refresh()
  }

  const schedule = async (queue = false) => {
    setScheduling(true)
    try {
      await flush()
      const blockImages =
        renderableBlockCount(value) > 0 && editorArea.current && services.uploadFile
          ? await renderBlockImages(editorArea.current, services.uploadFile)
          : []
      const options = Object.fromEntries(
        Object.entries(xOptions).flatMap(([id, chosen]) => {
          const request = selected.includes(id) ? xOptionsForRequest(chosen) : undefined
          return request ? [[id, request]] : []
        })
      )
      const result = await draftsApi.schedule(draft.id, {
        blockImages,
        channelConnectionIds: selected,
        options,
        ...(queue ? { queue: true } : { scheduledFor: new Date(scheduledFor).toISOString() }),
        naturalPostingTime: naturalTime,
        version: version.current,
      })
      version.current = result.draft.version
      setStatus(result.draft.status)
      setScheduleOpen(false)
      const first = result.posts[0]
      const when = first ? new Date(first.scheduledFor).toLocaleString() : ''
      const offset = first?.naturalOffsetSeconds
      const natural =
        offset !== null && offset !== undefined && offset !== 0
          ? ` (a natural ${offset > 0 ? '+' : '−'}${Math.floor(Math.abs(offset) / 60)}m${String(Math.abs(offset) % 60).padStart(2, '0')}s from the slot)`
          : ''
      toast.success(
        result.created
          ? `Scheduled ${result.posts.length} post${result.posts.length === 1 ? '' : 's'}${when ? ` for ${when}` : ''}${natural}.`
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

  const awaitingApproval =
    requireApproval &&
    !(review.reviewStatus === 'approved' && review.approvedVersion === version.current)

  // Best times are fetched when the schedule dialog first opens.
  React.useEffect(() => {
    if (!scheduleOpen || bestTimes.length > 0) return
    draftsApi
      .bestTimes()
      .then(({ items }) => setBestTimes(items))
      .catch(() => setBestTimes([]))
  }, [bestTimes.length, scheduleOpen])

  const toggleChannel = (id: string, on: boolean) => {
    setSelected((current) => (on ? [...current, id] : current.filter((item) => item !== id)))
    scheduleSave()
  }

  const saveLabel = { error: 'Not saved', saved: 'Saved', saving: 'Saving…', unsaved: 'Editing…' }[
    saveState
  ]
  const live = posts.filter((post) => post.status === 'SCHEDULED' || post.status === 'PROCESSING')
  // A draft stays scheduled after its posts go out: with nothing left to go
  // and something live, it has posted, and scheduling again is not a move.
  const posted =
    status === 'scheduled' && live.length === 0 && posts.some((post) => post.status === 'PUBLISHED')
  const rescheduling = status === 'scheduled' && !posted
  const handles = [...new Set(previews.map(({ channel }) => CHANNEL_META[channel].label))].join(
    ' · '
  )

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-3 border-b border-foreground/[0.06] bg-card/90 px-4 backdrop-blur">
        <Link
          aria-label="All drafts"
          className="text-muted-foreground hover:text-foreground md:hidden"
          href="/drafts"
        >
          ←
        </Link>
        <Input
          aria-label="Draft title"
          className="min-w-0 max-w-64 flex-1 truncate bg-transparent text-sm text-foreground/80 outline-none placeholder:text-muted-foreground/75 focus:text-foreground"
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
              <Button variant="custom" size={null}
                aria-label="Channels"
                className="flex h-7 items-center gap-1.5 rounded-full border border-foreground/[0.08] px-2.5 text-xs text-foreground/80 hover:border-foreground/20 hover:text-foreground"
                type="button"
              >
                {previews.length === 0
                  ? 'Choose channels'
                  : previews.map(({ channel, id }) => <ChannelIcon channel={channel} key={id} />)}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-2">
              <ChannelToggles channels={channels} onToggle={toggleChannel} selected={selected} />
            </PopoverContent>
          </Popover>
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          <DeveloperId id={draft.id} label="Draft" />
          <span className="text-xs text-muted-foreground" data-testid="save-state">
            {saveLabel}
          </span>
          {canEdit ? (
            <DraftDetails
              draftId={draft.id}
              onSaved={(saved) => {
                version.current = saved.version
                setDetails({ plannedFor: saved.plannedFor, tags: saved.tags })
              }}
              plannedFor={details.plannedFor}
              readVersion={() => version.current}
              tags={details.tags}
            />
          ) : null}
          {socialSet ? (
            <DraftSettingsDrawer canManage={canSchedule} canWrite={canEdit} socialSet={socialSet} />
          ) : null}
          {posted ? (
            <Pill tone="blue">Posted</Pill>
          ) : status === 'scheduled' ? (
            <Pill tone="green">Scheduled</Pill>
          ) : null}
          {requireApproval || review.reviewStatus !== 'none' ? (
            <ReviewControls
              canEdit={canEdit}
              canReview={canSchedule}
              draftId={draft.id}
              onDraft={onDraft}
              review={review}
            />
          ) : null}
          <HistorySheet
            draftId={draft.id}
            onRestore={(revision) => {
              const editor = editorHandle.current
              if (!editor || !revision.body) return
              // Through the editor, so a live session and undo both see it.
              editor.tf.setValue(revision.body as Value)
              setTitle(revision.title)
              scheduleSave()
            }}
          />
          <ShareMenu
            canEdit={canEdit}
            draftId={draft.id}
            onDraft={onDraft}
            shareToken={review.shareToken}
          />
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
              {rescheduling ? 'Reschedule' : 'Schedule'}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex-1">
        <div className="relative" ref={editorArea}>
          <DraftEditor
            assistChannel={
              previews.find(({ channel }) => THREAD_CHANNELS.has(channel))?.channel ??
              previews[0]?.channel ??
              'x'
            }
            collaboration={collaboration}
            draftId={draft.id}
            textDirection={textDirection}
            onEditor={(editor) => {
              editorHandle.current = editor
            }}
            handles={vocabulary.handles}
            hashtags={vocabulary.hashtags}
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
        <DraftPosts
          canSchedule={canSchedule}
          onCancel={cancelPost}
          onChange={(changed) =>
            setPosts((current) =>
              current.some((post) => post.id === changed.id)
                ? current.map((post) => (post.id === changed.id ? changed : post))
                : [changed, ...current]
            )
          }
          posts={posts}
        />
        <div className={cn('mb-40', POST_COLUMN)}>
          <GuestComments comments={guestComments} />
        </div>
      </div>

      <Dialog onOpenChange={setScheduleOpen} open={scheduleOpen}>
        <DialogContent className="max-h-[90dvh] max-w-md gap-5 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{rescheduling ? 'Reschedule' : 'Schedule'}</DialogTitle>
            <DialogDescription>
              All times in {Intl.DateTimeFormat().resolvedOptions().timeZone.replace('_', ' ')}.
              {socialSet ? ` The queue uses ${socialSet.name}'s slots in ${socialSet.timeZone.replace('_', ' ')}.` : ''}
              {live.length > 0 ? ' Its queued posts are replaced.' : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Input
              aria-label="When, in words"
              onChange={(event) => {
                setWhenText(event.target.value)
                const parsed = parseWhen(event.target.value)
                if (parsed) setScheduledFor(localInputValue(parsed))
              }}
              placeholder='Type a time: "tomorrow 9am", "in 3 hours", "fri 2pm"'
              value={whenText}
            />
            {whenText ? (
              <p className="text-xs text-muted-foreground" data-testid="when-reading">
                {parseWhen(whenText)
                  ? `→ ${new Date(scheduledFor).toLocaleString(undefined, {
                      dateStyle: 'full',
                      timeStyle: 'short',
                    })}`
                  : 'Not a time this reads yet.'}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {quickTimes().map((option) => (
                <Button variant="custom" size={null}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors',
                    scheduledFor === option.value
                      ? 'border-sky-400/60 bg-sky-400/10 text-sky-800 dark:text-white'
                      : 'border-foreground/[0.08] text-foreground/65 hover:text-foreground'
                  )}
                  key={option.label}
                  onClick={() => setScheduledFor(option.value)}
                  type="button"
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <Input
              aria-label="Schedule time"
              onChange={(event) => setScheduledFor(event.target.value)}
              type="datetime-local"
              value={scheduledFor}
            />
          </div>
          {bestTimes.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Best times</span>
              {bestTimes.map((best) => (
                <Button variant="custom" size={null}
                  className="rounded-full border border-emerald-400/30 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-200 hover:border-emerald-300/60"
                  key={best.at}
                  onClick={() => {
                    setScheduledFor(localInputValue(new Date(best.at)))
                    setWhenText('')
                  }}
                  title={best.reason}
                  type="button"
                >
                  {new Date(best.at).toLocaleString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                    weekday: 'short',
                  })}
                </Button>
              ))}
            </div>
          ) : null}
          <ChannelToggles
            channels={channels}
            onToggle={toggleChannel}
            results={new Map(previews.map(({ id, result }) => [id, result]))}
            selected={selected}
          />
          {previews
            .filter(({ channel }) => channel === 'x')
            .map(({ id, name, result }) => (
              <div key={id}>
                <p className="text-xs text-muted-foreground">{name}</p>
                <XOptions
                  hasImages={result.posts[0]?.images > 0}
                  onChange={(next) => setXOptions((current) => ({ ...current, [id]: next }))}
                  value={xOptions[id] ?? {}}
                />
              </div>
            ))}
          <Label className="flex items-center justify-between gap-3 text-sm text-foreground">
            <span>
              Natural posting time
              <span className="block text-xs text-muted-foreground">
                Up to four minutes either side, chosen once and kept for this schedule.
              </span>
            </span>
            <Switch aria-label="Natural posting time" checked={naturalTime} onCheckedChange={setNaturalTime} />
          </Label>
          {unhealthy.length > 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-300" role="alert">
              {unhealthy.map(({ health, name }) => `${name}: ${UNHEALTHY[health ?? ''] ?? 'Not ready to publish.'}`).join(' ')}
            </p>
          ) : null}
          {awaitingApproval ? (
            <p className="text-xs text-amber-700 dark:text-amber-300" role="alert">
              This workspace approves drafts before they are scheduled. Ask for review first.
            </p>
          ) : null}
          {degraded.length > 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-300" role="alert">
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
            <Button
              disabled={blocked || scheduling || awaitingApproval}
              onClick={() => void schedule(true)}
              variant="outline"
            >
              Add to queue
            </Button>
            <Button
              disabled={blocked || scheduling || awaitingApproval}
              onClick={() => void schedule()}
            >
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
            {previews.map(({ avatarUrl, channel, handle, id, name, result }) => (
              <PostPreview
                channel={channel}
                custom={channelText[channel]}
                account={{ avatarUrl, handle, name }}
                key={id}
                onCustomize={
                  canEdit
                    ? (next) => {
                        setChannelText((current) => ({ ...current, [channel]: next ?? '' }))
                        scheduleSave()
                      }
                    : undefined
                }
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
        className="relative z-[1] -ml-12 hidden size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500/40 to-violet-500/40 text-sm font-medium text-white ring-4 ring-card sm:flex"
        data-post-avatar
      >
        {author.slice(0, 1).toUpperCase()}
      </span>
      <p className="min-w-0 flex-1 truncate text-sm">
        <span className="font-medium text-foreground">{author}</span>
        {handles ? <span className="ml-1.5 text-muted-foreground">{handles}</span> : null}
      </p>
      {number > 1 || xLength !== undefined ? (
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {xLength !== undefined ? (
            <span className={xLength > 280 ? 'text-red-700 dark:text-red-400' : undefined}>{xLength} / 280</span>
          ) : null}
          <span>#{number}</span>
        </span>
      ) : null}
    </div>
  )
}

/** A date as a `datetime-local` value, in local time. */
function localInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Cards already read this session, by link: the preview opens often. */
const linkCards = new Map<string, Promise<z.output<typeof linkCardSchema> | null>>()

/**
 * The card a channel shows for the first link in a post without media: the
 * page's title, description, image and site, read once per link.
 */
function LinkCard({ text }: { text: string }) {
  const url = /https?:\/\/[^\s]+/.exec(text)?.[0]?.replace(/[.,!?;:)'"\]]+$/, '')
  const [card, setCard] = React.useState<z.output<typeof linkCardSchema> | null>(null)
  React.useEffect(() => {
    if (!url) return
    let current = true
    if (!linkCards.has(url))
      linkCards.set(
        url,
        draftsApi.linkCard(url).catch(() => null)
      )
    void linkCards.get(url)?.then((found) => {
      if (current) setCard(found)
    })
    return () => {
      current = false
    }
  }, [url])
  if (!url || !card || card.url === undefined) return null
  return (
    <a
      className="mt-3 block overflow-hidden rounded-xl border border-foreground/[0.08] hover:border-foreground/20"
      data-testid="link-card"
      href={card.url}
      rel="noreferrer"
      target="_blank"
    >
      {card.image ? (
        // biome-ignore lint/performance/noImgElement: a page's own Open Graph image
        <img alt="" className="aspect-[1.91/1] w-full bg-foreground/5 object-cover" src={card.image} />
      ) : null}
      <span className="block p-3">
        <span className="block text-[11px] text-muted-foreground">
          {card.siteName ?? new URL(card.url).hostname}
        </span>
        <span className="block truncate text-sm text-foreground">{card.title ?? card.url}</span>
        {card.description ? (
          <span className="line-clamp-2 block text-xs text-foreground/65">{card.description}</span>
        ) : null}
      </span>
    </a>
  )
}

/** Quick picks for the schedule time, as `datetime-local` values. */
function quickTimes(): { label: string; value: string }[] {
  const at = localInputValue
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
      {channels.map(({ channel, handle, health, id, name }) => {
        const result = results?.get(id)
        const problem = health && health !== 'connected' ? (UNHEALTHY[health] ?? 'Not ready to publish.') : null
        return (
          <li className="rounded-lg px-2 py-1.5 hover:bg-foreground/[0.03]" key={id}>
            <Label className="flex cursor-pointer items-center gap-3 text-sm text-foreground">
              <ChannelIcon channel={channel} className="size-4 text-foreground/65" />
              <span className="min-w-0 flex-1 truncate">
                {name}
                <span className="ml-1.5 text-muted-foreground">
                  {handle ? `@${handle}` : CHANNEL_META[channel].label}
                </span>
              </span>
              <Switch
                aria-label={`${channel} · ${name}`}
                checked={selected.includes(id)}
                className="shrink-0"
                disabled={Boolean(problem) && !selected.includes(id)}
                onCheckedChange={(checked) => onToggle(id, (checked === true))}
              />
            </Label>
            {problem ? (
              <p className="pl-7 text-xs text-amber-700 dark:text-amber-300">{problem}</p>
            ) : null}
            {result ? (
              <div className="mt-1 flex flex-col gap-0.5 pl-7">
                <CharacterCount channel={channel} result={result} />
                {result.errors.map((error) => (
                  <p className="text-xs text-red-700 dark:text-red-400" key={error} role="alert">
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
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <ChannelIcon channel={channel} className="size-3.5" />
      <svg aria-hidden className="size-4 -rotate-90" viewBox="0 0 18 18">
        <circle className="stroke-foreground/10" cx="9" cy="9" fill="none" r="7" strokeWidth="2" />
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
        className={over ? 'text-red-700 dark:text-red-400' : undefined}
        data-testid={testId ? `counter-${channel}` : undefined}
      >
        {result.length} / {result.limit}
      </span>
    </span>
  )
}

/** The post as its channel lays it out: author, text, images, and what changes. */
function PostPreview({
  account,
  channel,
  custom,
  onCustomize,
  result,
}: {
  /** The account the post goes out as. */
  account: { avatarUrl: string | null; handle: string | null; name: string }
  channel: DraftChannel
  /** This channel's own text, when it says something different. */
  custom?: string
  /** Set this channel's own text; undefined goes back to the draft's. */
  onCustomize?: (text: string | undefined) => void
  result: SerializedCaption
}) {
  const label = CHANNEL_META[channel].label
  const [editing, setEditing] = React.useState(false)
  return (
    <article
      className="rounded-xl border border-foreground/[0.08] bg-black/30 p-4"
      data-testid={`preview-${channel}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <ChannelIcon channel={channel} />
          {label}
          {custom ? (
            <span className="rounded-full bg-sky-400/10 px-1.5 py-0.5 normal-case tracking-normal text-sky-700 dark:text-sky-300">
              Own text
            </span>
          ) : null}
        </p>
        {onCustomize ? (
          <Button variant="custom" size={null}
            className="text-xs text-foreground/65 hover:text-foreground"
            onClick={() => {
              if (!editing && !custom)
                onCustomize(result.posts.map((post) => post.caption).join('\n\n\n'))
              setEditing(!editing)
            }}
            type="button"
          >
            {editing ? 'Done' : `Write it differently for ${label}`}
          </Button>
        ) : null}
      </div>
      {editing && onCustomize ? (
        <div className="mb-3 flex flex-col gap-1.5">
          <Textarea
            aria-label={`${label} text`}
            className="min-h-32 w-full rounded-lg border border-foreground/[0.08] bg-black/40 p-2 text-sm text-foreground outline-none focus:border-sky-400/50"
            onChange={(event) => onCustomize(event.target.value)}
            value={custom ?? ''}
          />
          <p className="flex justify-between text-[11px] text-muted-foreground">
            <span>
              {THREAD_CHANNELS.has(channel)
                ? 'Two empty lines start the next post.'
                : 'Posted as written.'}
            </span>
            <Button variant="custom" size={null}
              className="hover:text-foreground"
              onClick={() => {
                onCustomize(undefined)
                setEditing(false)
              }}
              type="button"
            >
              Use the draft&apos;s text
            </Button>
          </p>
        </div>
      ) : null}
      {(result.posts.length > 0 ? result.posts : [{ assetIds: [], caption: '' }]).map(
        (post, index, posts) => (
          <div className="relative flex gap-3 pb-4 last:pb-0" key={index}>
            {index < posts.length - 1 ? (
              // The thread line, from this avatar down to the next.
              <span aria-hidden className="absolute top-10 bottom-0 left-[18px] w-px bg-foreground/10" />
            ) : null}
            {account.avatarUrl ? (
              // biome-ignore lint/performance/noImgElement: a provider avatar URL
              <img
                alt=""
                className="size-9 shrink-0 rounded-full bg-foreground/5 object-cover"
                src={account.avatarUrl}
              />
            ) : (
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500/40 to-violet-500/40 text-sm text-white"
              >
                {account.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <span className="font-medium text-foreground">{account.name}</span>
                {account.handle ? (
                  <span className="ml-1.5 text-muted-foreground">@{account.handle}</span>
                ) : null}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
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
                      className="aspect-video w-full bg-foreground/5 object-cover"
                      key={assetId}
                      src={assetContentUrl(assetId)}
                    />
                  ))}
                </div>
              ) : (
                <LinkCard text={post.caption} />
              )}
            </div>
          </div>
        )
      )}
      <div className="mt-3 flex flex-col gap-1 border-t border-foreground/[0.06] pt-3">
        <CharacterCount channel={channel} result={result} />
        {result.errors.map((error) => (
          <p className="text-xs text-red-700 dark:text-red-400" key={error} role="alert">
            {error}
          </p>
        ))}
        {result.degradations.map((item) => (
          <p className="text-xs text-amber-700 dark:text-amber-300" key={item.kind}>
            {item.message}
          </p>
        ))}
      </div>
    </article>
  )
}
