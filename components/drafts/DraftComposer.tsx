'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { toast } from 'sonner'
import type { Value } from '@shots/platejs-editor/platejs'
import { Group, Page, Pill, type PillTone, Row, Section } from '@/components/platform-ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DraftRequestError, type DraftPostWire, draftsApi } from '@/lib/content-drafts/client'
import { type DraftChannel, draftPlainText, serializeDraft } from '@/lib/content-drafts/serialize'
import { platformEditorServices } from '@/lib/editor/services'
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
 * The content draft composer: the editor, autosave keyed on the version, the
 * channel picker with a live preview and counter per channel, and scheduling.
 */
export function DraftComposer({
  aiEnabled,
  canEdit,
  canSchedule,
  channels,
  draft,
  posts: initialPosts,
  user,
}: {
  aiEnabled: boolean
  canEdit: boolean
  canSchedule: boolean
  channels: ComposerChannel[]
  draft: ComposerDraft
  posts: DraftPostWire[]
  user: DraftEditorUser
}) {
  const trpcClient = useTRPCClient()
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
  const [confirming, setConfirming] = React.useState(false)
  const version = React.useRef(draft.version)
  const latest = React.useRef({ selected, title, value })
  latest.current = { selected, title, value }
  const inFlight = React.useRef<Promise<void> | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

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
          plainText: draftPlainText(nextValue),
          title: nextTitle,
        })
        version.current = saved.version
        setStatus(saved.status)
        setSaveState('saved')
      } catch (error) {
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
  }, [canEdit, draft.id, reloadLatest])

  const scheduleSave = React.useCallback(() => {
    if (!canEdit) return
    setSaveState('unsaved')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS)
  }, [canEdit, save])

  const flush = React.useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    await save()
  }, [save])

  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const previews = channels
    .filter((channel) => selected.includes(channel.id))
    .map((channel) => ({ ...channel, result: serializeDraft(value, channel.channel) }))
  const blocked = previews.length === 0 || previews.some(({ result }) => result.errors.length > 0)
  const degraded = previews.filter(({ result }) => result.degradations.length > 0)

  const refreshPosts = async () => setPosts((await draftsApi.posts(draft.id)).posts)

  const schedule = async () => {
    setScheduling(true)
    try {
      await flush()
      const result = await draftsApi.schedule(draft.id, {
        channelConnectionIds: selected,
        scheduledFor: new Date(scheduledFor).toISOString(),
        version: version.current,
      })
      version.current = result.draft.version
      setStatus(result.draft.status)
      setConfirming(false)
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

  const saveLabel = { error: 'Not saved', saved: 'Saved', saving: 'Saving…', unsaved: 'Editing…' }[
    saveState
  ]

  return (
    <Page
      actions={
        <>
          <span className="text-xs text-neutral-500" data-testid="save-state">
            {saveLabel}
          </span>
          <Pill tone={status === 'scheduled' ? 'green' : 'yellow'}>{status}</Pill>
          {canEdit ? (
            <Button onClick={() => void flush()} variant="outline">
              Save draft
            </Button>
          ) : null}
          <Link className="text-sm text-neutral-400 hover:text-white" href="/drafts">
            All drafts
          </Link>
        </>
      }
      title="Draft"
    >
      <Input
        aria-label="Draft title"
        className="text-lg"
        disabled={!canEdit}
        maxLength={200}
        onChange={(event) => {
          setTitle(event.target.value)
          scheduleSave()
        }}
        value={title}
      />
      <div className="overflow-hidden rounded-2xl bg-white/[0.015] ring-1 ring-white/[0.08]">
        <DraftEditor
          initialValue={editorState.value}
          key={editorState.key}
          onChange={(next) => {
            setValue(next)
            scheduleSave()
          }}
          readOnly={!canEdit}
          services={services}
          title={title}
          user={user}
        />
      </div>

      {canSchedule ? (
        <Section
          description="Each channel gets its own plain-text caption, checked against its limit."
          title="Schedule"
        >
          <Group>
            <Row label="Channels" layout="stacked">
              {channels.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  Connect a channel in workspace settings to schedule this draft.
                </p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {channels.map((channel) => (
                    <label
                      className="flex items-center gap-2 text-sm text-neutral-200"
                      key={channel.id}
                    >
                      <input
                        checked={selected.includes(channel.id)}
                        onChange={(event) => {
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, channel.id]
                              : current.filter((id) => id !== channel.id)
                          )
                          setConfirming(false)
                          scheduleSave()
                        }}
                        type="checkbox"
                      />
                      {channel.channel} · {channel.name}
                    </label>
                  ))}
                </div>
              )}
            </Row>
            {previews.map(({ channel, id, name, result }) => (
              <Row key={id} label={`${channel} · ${name}`} layout="stacked">
                <div className="flex w-full flex-col gap-2" data-testid={`preview-${channel}`}>
                  <pre className="w-full whitespace-pre-wrap rounded-lg bg-black/30 p-3 font-sans text-sm text-neutral-200">
                    {result.caption || ' '}
                  </pre>
                  <p
                    className={
                      result.length > result.limit
                        ? 'text-xs text-red-400'
                        : 'text-xs text-neutral-500'
                    }
                    data-testid={`counter-${channel}`}
                  >
                    {result.length} / {result.limit}
                  </p>
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
              </Row>
            ))}
            <Row label="When">
              <Input
                aria-label="Schedule time"
                onChange={(event) => setScheduledFor(event.target.value)}
                type="datetime-local"
                value={scheduledFor}
              />
            </Row>
            <Row>
              {confirming ? (
                <div className="flex flex-col gap-3" role="alert">
                  <p className="text-sm text-amber-300">
                    Some content changes when posted:{' '}
                    {degraded
                      .map(
                        ({ channel, result }) =>
                          `${channel}: ${result.degradations.map((item) => item.message).join(' ')}`
                      )
                      .join(' ')}
                  </p>
                  <div className="flex gap-2">
                    <Button disabled={scheduling} onClick={() => void schedule()}>
                      Schedule anyway
                    </Button>
                    <Button onClick={() => setConfirming(false)} variant="outline">
                      Keep editing
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  disabled={blocked || scheduling}
                  onClick={() => (degraded.length > 0 ? setConfirming(true) : void schedule())}
                >
                  {status === 'scheduled' ? 'Reschedule' : 'Schedule'}
                </Button>
              )}
            </Row>
          </Group>
        </Section>
      ) : null}

      {posts.length > 0 ? (
        <Section title="Scheduled posts">
          <Group>
            {posts.map((post) => (
              <div
                className="flex items-center justify-between gap-4 p-5"
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
              </div>
            ))}
          </Group>
        </Section>
      ) : null}
    </Page>
  )
}
