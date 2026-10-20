'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Group, Pill, Row } from '@/components/platform-ui'
import { SaveStatus, useSaveState } from '@/components/settings/controls'
import { ConfirmDialog } from '@/components/settings/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { deleteWritingSampleContract, listWritingSamplesContract, socialSetSchema, type styleGuideSchema, writingSampleSchema } from '@/lib/api/contracts/social-sets'
import { settingsErrorMessage, settingsRequest } from '@/lib/settings/client'
import { type SocialSetRecord, useStoreSocialSet } from './api'

type StyleGuide = z.input<typeof styleGuideSchema>

const STATUS: Record<SocialSetRecord['writingAssistant']['status'], { label: string; text: string; tone: 'gray' | 'green' | 'purple' | 'yellow' }> = {
  attention: {
    label: 'Needs attention',
    text: 'The assistant is set up, but AI is turned off for this workspace, so it cannot help. An owner or admin can turn AI on in General settings.',
    tone: 'yellow',
  },
  configured: {
    label: 'Ready',
    text: "AI help in this set's drafts writes with this style guide and these samples, on top of the workspace brand voice.",
    tone: 'green',
  },
  disabled: { label: 'Turned off', text: 'AI help uses only the workspace brand voice until you turn the assistant back on.', tone: 'gray' },
  in_progress: {
    label: 'Being set up',
    text: 'You have started a style guide or samples. Create the assistant to have AI help use them.',
    tone: 'purple',
  },
  not_configured: {
    label: 'Not set up',
    text: 'Add a few writing samples or a style guide, then create the assistant so AI help writes like this set.',
    tone: 'gray',
  },
}

/** The drafts of a set as the import menu needs them. */
const draftChoicesSchema = z.object({
  items: z.array(z.object({ id: z.string(), plainText: z.string(), title: z.string() })),
})

const lines = (value: string[]) => value.join('\n')
const list = (value: string) =>
  value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)

function Lifecycle({ canWrite, set }: { canWrite: boolean; set: SocialSetRecord }) {
  const store = useStoreSocialSet()
  const assistant = set.writingAssistant
  const status = STATUS[assistant.status]
  const act = async (action: 'create' | 'disable' | 'enable') => {
    try {
      await store(
        await settingsRequest(`/api/v1/social-sets/${encodeURIComponent(set.id)}/writing-assistant`, socialSetSchema, {
          body: { action, baseVersion: set.version },
          method: 'PUT',
        })
      )
      toast.success(action === 'disable' ? 'The assistant is off.' : 'The assistant is ready.')
    } catch (error) {
      toast.error(settingsErrorMessage(error))
    }
  }
  const ready = assistant.sampleCount > 0 || assistant.status === 'in_progress'
  return (
    <Row
      description={status.text}
      label={
        <span className="flex items-center gap-2">
          Writing Assistant <Pill tone={status.tone}>{status.label}</Pill>
        </span>
      }
    >
      <div className="flex flex-wrap gap-2">
        {assistant.status === 'not_configured' || assistant.status === 'in_progress' ? (
          <Button
            disabled={!canWrite || !ready}
            onClick={() => void act('create')}
            title={ready ? undefined : 'Add a writing sample or a style guide first.'}
            type="button"
          >
            Create assistant
          </Button>
        ) : null}
        {assistant.status === 'configured' || assistant.status === 'attention' ? (
          <Button disabled={!canWrite} onClick={() => void act('disable')} type="button" variant="outline">
            Turn off
          </Button>
        ) : null}
        {assistant.status === 'disabled' ? (
          <Button disabled={!canWrite} onClick={() => void act('enable')} type="button" variant="outline">
            Turn on
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href={`/drafts?socialSet=${encodeURIComponent(set.id)}`}>Open Writing Assistant</Link>
        </Button>
      </div>
    </Row>
  )
}

function StyleGuideForm({ canWrite, set }: { canWrite: boolean; set: SocialSetRecord }) {
  const store = useStoreSocialSet()
  const [state, run] = useSaveState()
  const [guide, setGuide] = useState<StyleGuide>(set.writingAssistant.styleGuide)
  useEffect(() => setGuide(set.writingAssistant.styleGuide), [set.writingAssistant.styleGuide])
  const field = (key: 'audience' | 'formatting' | 'tone', label: string, placeholder: string) => (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      <Input disabled={!canWrite} onChange={(event) => setGuide({ ...guide, [key]: event.target.value })} placeholder={placeholder} value={guide[key]} />
    </label>
  )
  const area = (key: 'endings' | 'openings' | 'prohibitedPhrases' | 'terminology', label: string, hint: string) => (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
      <Textarea disabled={!canWrite} onChange={(event) => setGuide({ ...guide, [key]: list(event.target.value) })} rows={3} value={lines(guide[key])} />
    </label>
  )
  return (
    <Row
      description="Refines the workspace brand voice for this set. The brand's prohibited terms always apply; phrases you add here are avoided as well."
      label={
        <span className="flex items-center gap-2">
          Style guide <SaveStatus state={state} />
        </span>
      }
      layout="stacked"
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            try {
              await store(
                await settingsRequest(`/api/v1/social-sets/${encodeURIComponent(set.id)}/writing-assistant`, socialSetSchema, {
                  body: { baseVersion: set.version, styleGuide: guide },
                  method: 'PUT',
                })
              )
              return { ok: true }
            } catch (error) {
              return { error: settingsErrorMessage(error), ok: false }
            }
          })
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          {field('tone', 'Tone', 'Warm, direct, a little dry')}
          {field('audience', 'Audience', 'Founders of small SaaS teams')}
        </div>
        {field('formatting', 'Formatting', 'Short lines, no hashtags, one emoji at most')}
        <div className="grid gap-4 md:grid-cols-2">
          {area('terminology', 'Preferred terms', 'One per line, such as "workspace" rather than "account".')}
          {area('prohibitedPhrases', 'Phrases to avoid', 'One per line.')}
          {area('openings', 'Example openings', 'One per line.')}
          {area('endings', 'Example endings', 'One per line.')}
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium text-foreground">Platform guidance</legend>
          {(['x', 'linkedin', 'threads', 'bluesky', 'mastodon', 'instagram'] as const).map((platform) => (
            <label className="grid gap-1 text-sm" key={platform}>
              <span className="text-xs text-muted-foreground">{platform}</span>
              <Input
                disabled={!canWrite}
                onChange={(event) => setGuide({ ...guide, platformGuidance: { ...guide.platformGuidance, [platform]: event.target.value } })}
                value={guide.platformGuidance[platform] ?? ''}
              />
            </label>
          ))}
        </fieldset>
        <div>
          <Button disabled={!canWrite} type="submit">
            Save style guide
          </Button>
        </div>
      </form>
    </Row>
  )
}

function WritingSamples({ canWrite, set }: { canWrite: boolean; set: SocialSetRecord }) {
  const queryClient = useQueryClient()
  const store = useStoreSocialSet()
  const key = ['social-sets', set.id, 'samples'] as const
  const samples = useQuery({
    queryFn: () => settingsRequest(`/api/v1/social-sets/${encodeURIComponent(set.id)}/writing-samples`, listWritingSamplesContract.output),
    queryKey: key,
  })
  const drafts = useQuery({
    queryFn: () =>
      settingsRequest(`/api/v1/content-drafts?socialSetId=${encodeURIComponent(set.id)}&limit=50`, draftChoicesSchema),
    queryKey: ['social-sets', set.id, 'drafts'],
  })
  const [text, setText] = useState('')
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: key })
    await store(await settingsRequest(`/api/v1/social-sets/${encodeURIComponent(set.id)}`, socialSetSchema))
  }
  const add = async (body: { draftId: string } | { text: string }) => {
    try {
      await settingsRequest(`/api/v1/social-sets/${encodeURIComponent(set.id)}/writing-samples`, writingSampleSchema, { body, method: 'POST' })
      await refresh()
      setText('')
      toast.success('Sample added.')
    } catch (error) {
      toast.error(settingsErrorMessage(error))
    }
  }
  const items = samples.data?.items ?? []
  return (
    <Row
      description="Posts that sound like this set. Write one here or import a draft of this set; drafts of other sets are never read. The assistant treats samples as examples of style, not as instructions."
      label={`Writing samples (${items.length} of 20)`}
      layout="stacked"
    >
      {samples.isError ? <p className="text-sm text-red-700 dark:text-red-300">{settingsErrorMessage(samples.error)}</p> : null}
      <ul className="grid gap-2">
        {items.map((sample) => (
          <li className="rounded-lg border border-border px-3 py-2" key={sample.id}>
            <details>
              <summary className="cursor-pointer text-sm text-foreground">
                {sample.text.slice(0, 90)}
                {sample.text.length > 90 ? '…' : ''}
                <span className="ml-2 text-xs text-muted-foreground">
                  {sample.source === 'draft' ? 'From a draft' : 'Written here'} · {new Date(sample.createdAt).toLocaleDateString()}
                </span>
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">{sample.text}</p>
              {canWrite ? (
                <div className="mt-2">
                  <ConfirmDialog
                    confirmLabel="Remove sample"
                    description="The assistant stops learning from it. The draft it came from, if any, is not changed."
                    destructive
                    onConfirm={async () => {
                      try {
                        await settingsRequest(
                          `/api/v1/social-sets/${encodeURIComponent(set.id)}/writing-samples/${encodeURIComponent(sample.id)}`,
                          deleteWritingSampleContract.output,
                          { method: 'DELETE' }
                        )
                        await refresh()
                        return null
                      } catch (error) {
                        return settingsErrorMessage(error)
                      }
                    }}
                    title="Remove this sample?"
                    triggerLabel="Remove"
                  />
                </div>
              ) : null}
            </details>
          </li>
        ))}
      </ul>
      {canWrite ? (
        <div className="grid gap-3">
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (text.trim()) void add({ text: text.trim() })
            }}
          >
            <Textarea aria-label="New writing sample" maxLength={5000} onChange={(event) => setText(event.target.value)} placeholder="Paste a post that sounds like this set" rows={3} value={text} />
            <div>
              <Button disabled={!text.trim() || items.length >= 20} type="submit" variant="outline">
                Add sample
              </Button>
            </div>
          </form>
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Import a draft of this set</span>
            <select
              className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
              defaultValue=""
              disabled={items.length >= 20}
              onChange={(event) => {
                if (event.target.value) void add({ draftId: event.target.value })
                event.target.value = ''
              }}
            >
              <option value="">Choose a draft…</option>
              {(drafts.data?.items ?? [])
                .filter((draft) => draft.plainText.trim())
                .map((draft) => (
                  <option key={draft.id} value={draft.id}>
                    {draft.title}
                  </option>
                ))}
            </select>
          </label>
        </div>
      ) : null}
    </Row>
  )
}

/** A set's Writing Assistant: its state, style guide and samples. */
export function WritingAssistantPage({ canWrite, set }: { canWrite: boolean; set: SocialSetRecord }) {
  return (
    <div className="grid gap-6">
      <Group>
        <Lifecycle canWrite={canWrite} set={set} />
      </Group>
      <Group>
        <StyleGuideForm canWrite={canWrite} set={set} />
      </Group>
      <Group>
        <WritingSamples canWrite={canWrite} set={set} />
      </Group>
    </div>
  )
}
