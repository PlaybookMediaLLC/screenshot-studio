'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { call } from '@/lib/content-drafts/client'
import { writeApi } from '@/lib/write/client'
import type { DraftChannel } from '@/lib/write/document'
import { useWrite, type WriteSet } from '../write-context'

/** One turn of the conversation. */
type Turn = { content: string; role: 'assistant' | 'user' }

/** Starting points for a conversation about the draft. */
const STARTERS = [
  'Give me three stronger hooks for the first post.',
  'How could the ending get more replies?',
  'What is unclear or too long here?',
  'Adapt this for LinkedIn.',
]

/**
 * The writing assistant (RFC 042): a conversation about the open draft in
 * the set's voice, from the style guide and samples saved on the set. The
 * conversation stays in this panel; nothing in the draft changes unless the
 * writer adds a reply to it. Each answer uses the workspace's AI credits.
 */
export function AssistantPanel({
  channel,
  onInsert,
  posts,
  set,
}: {
  channel: DraftChannel
  /** Add a reply to the draft as a new post. */
  onInsert?: (text: string) => void
  /** The draft's posts as the platform reads them. */
  posts: string[]
  set: WriteSet | null
}) {
  const [turns, setTurns] = React.useState<Turn[]>([])
  const [message, setMessage] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [setup, setSetup] = React.useState(false)
  const [skipped, setSkipped] = React.useState(false)
  const configured = Boolean(set?.preferences.voice || set?.preferences.samples?.length)
  const send = async (text: string) => {
    const content = text.trim()
    if (!content || busy) return
    const next: Turn[] = [...turns, { content, role: 'user' }]
    setTurns(next)
    setMessage('')
    setBusy(true)
    try {
      const answer = await call<{ reply: string }>('/api/v1/content-drafts/assistant', {
        body: { channel, draft: posts, messages: next.slice(-30), socialSetId: set?.id },
        method: 'POST',
      })
      setTurns([...next, { content: answer.reply, role: 'assistant' }])
    } catch (error) {
      setTurns(turns)
      setMessage(content)
      toast.error(error instanceof Error ? error.message : 'The assistant could not answer.')
    } finally {
      setBusy(false)
    }
  }
  if (setup || (!configured && !skipped && turns.length === 0 && set)) {
    return (
      <AssistantSetup
        onDone={() => {
          setSetup(false)
          setSkipped(true)
        }}
        set={set}
      />
    )
  }
  return (
    <div className="flex h-full flex-col gap-3 p-4 text-sm" data-testid="assistant-panel">
      <p className="text-xs text-neutral-500">
        Writing in {set?.name ?? 'this set'}’s voice
        {configured ? '' : ' (no style guide yet)'}.{' '}
        <Button
          className="text-sky-300"
          onClick={() => setSetup(true)}
          size={null}
          type="button"
          variant="custom"
        >
          Style guide and samples
        </Button>
      </p>
      {turns.length === 0 ? (
        <div className="grid gap-1.5">
          {STARTERS.map((starter) => (
            <Button
              className="h-auto justify-start whitespace-normal rounded-lg border border-white/[0.06] px-3 py-2 text-left text-xs"
              key={starter}
              onClick={() => void send(starter)}
              size={null}
              type="button"
              variant="ghost"
            >
              {starter}
            </Button>
          ))}
        </div>
      ) : (
        <ol aria-live="polite" className="grid gap-3">
          {turns.map((turn, index) => (
            <li
              className={
                turn.role === 'user'
                  ? 'ml-6 rounded-lg bg-white/[0.06] px-3 py-2'
                  : 'rounded-lg border border-white/[0.06] px-3 py-2'
              }
              data-testid={`assistant-${turn.role}`}
              key={index}
            >
              <p className="whitespace-pre-wrap text-neutral-200">{turn.content}</p>
              {turn.role === 'assistant' ? (
                <p className="mt-1.5 flex gap-2 text-xs">
                  {onInsert ? (
                    <Button
                      className="text-sky-300"
                      onClick={() => onInsert(turn.content)}
                      size={null}
                      type="button"
                      variant="custom"
                    >
                      Add as a new post
                    </Button>
                  ) : null}
                  <Button
                    className="text-neutral-400 hover:text-white"
                    onClick={() => {
                      void navigator.clipboard.writeText(turn.content)
                      toast.success('Copied.')
                    }}
                    size={null}
                    type="button"
                    variant="custom"
                  >
                    Copy
                  </Button>
                </p>
              ) : null}
            </li>
          ))}
          {busy ? <li className="text-xs text-neutral-500">Writing…</li> : null}
        </ol>
      )}
      <form
        className="mt-auto grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void send(message)
        }}
      >
        <Textarea
          aria-label="Ask the assistant"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send(message)
            }
          }}
          placeholder="Ask about this draft…"
          rows={3}
          value={message}
        />
        <span className="flex items-center justify-between text-[11px] text-neutral-500">
          Uses your workspace’s AI credits.
          <Button disabled={busy || !message.trim()} size="sm" type="submit">
            Send
          </Button>
        </span>
      </form>
    </div>
  )
}

/** The set's style guide, audience and writing samples, which the assistant and Refine follow. */
function AssistantSetup({ onDone, set }: { onDone: () => void; set: WriteSet | null }) {
  const router = useRouter()
  const { canManageSets } = useWrite()
  const [voice, setVoice] = React.useState(set?.preferences.voice ?? '')
  const [audience, setAudience] = React.useState(set?.preferences.audience ?? '')
  const [samples, setSamples] = React.useState((set?.preferences.samples ?? []).join('\n---\n'))
  const [busy, setBusy] = React.useState(false)
  const save = async () => {
    if (!set) return
    setBusy(true)
    try {
      await writeApi.updateSet(set.id, {
        preferences: {
          ...set.preferences,
          audience: audience.trim() || undefined,
          samples: samples
            .split(/\n\s*---\s*\n/)
            .map((sample) => sample.trim())
            .filter(Boolean)
            .slice(0, 20),
          voice: voice.trim() || undefined,
        },
      })
      toast.success('Saved for this set.')
      router.refresh()
      onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The style guide did not save.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-3 p-4 text-sm" data-testid="assistant-setup">
      <p className="text-neutral-300">Set up the assistant for {set?.name ?? 'this set'}</p>
      <p className="text-xs text-neutral-500">
        The assistant and Refine write in this voice. Everyone who writes in the set shares it.
      </p>
      {canManageSets ? (
        <>
          <Label className="grid gap-1 text-xs text-neutral-400">
            Style guide
            <Textarea
              maxLength={2_000}
              onChange={(event) => setVoice(event.target.value)}
              placeholder="Plain words, short sentences, no hype. First person plural."
              rows={4}
              value={voice}
            />
          </Label>
          <Label className="grid gap-1 text-xs text-neutral-400">
            Audience
            <Textarea
              maxLength={2_000}
              onChange={(event) => setAudience(event.target.value)}
              placeholder="Who reads these posts, and what they care about."
              rows={2}
              value={audience}
            />
          </Label>
          <Label className="grid gap-1 text-xs text-neutral-400">
            Writing samples, separated by a line with ---
            <Textarea
              onChange={(event) => setSamples(event.target.value)}
              rows={6}
              value={samples}
            />
          </Label>
          <Button disabled={busy} onClick={() => void save()} type="button">
            Save for this set
          </Button>
        </>
      ) : (
        <p className="text-xs text-neutral-400">
          An owner or admin sets the style guide for a set.
        </p>
      )}
      <Button onClick={onDone} size="sm" type="button" variant="ghost">
        {set?.preferences.voice || set?.preferences.samples?.length ? 'Back' : 'Skip for now'}
      </Button>
    </div>
  )
}
