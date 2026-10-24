'use client'

import * as React from 'react'
import { toast } from 'sonner'
import type { PlateEditor, PlateElementProps } from '@shots/platejs-editor/platejs/react'
import { createPlatePlugin, PlateElement, useSelected } from '@shots/platejs-editor/platejs/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CHANNEL_META, ChannelIcon } from '@/components/drafts/channel-meta'
import { call } from '@/lib/content-drafts/client'
import { SOCIAL_MENTION } from '@/lib/content-drafts/serialize'
import type { DraftChannel } from '@/lib/write/document'
import { cn } from '@/lib/utils'

/**
 * Atomic social mentions (RFC 042): an account picked from the platform's
 * own lookup, kept as one inline element that cannot be split or half
 * deleted. It is written per platform at publishing: the LinkedIn
 * annotation for a LinkedIn organization, the @handle for an X user, and
 * the plain name anywhere else, so it never tags the wrong account.
 */

/** A mention as the lookup returns it. */
type FoundMention = {
  handle?: string
  image?: string
  kind: 'person' | 'organization'
  label: string
  providerId: string
}

type MentionNode = {
  handle?: string
  label?: string
  platform?: DraftChannel
  providerId?: string
}

function SocialMentionElement(props: PlateElementProps) {
  const node = props.element as MentionNode
  const selected = useSelected()
  return (
    <PlateElement
      {...props}
      as="span"
      attributes={{ ...props.attributes, contentEditable: false, draggable: true }}
      className={cn(
        'mx-0.5 inline-flex items-baseline gap-1 rounded-md bg-sky-400/10 px-1 align-baseline text-sky-200',
        selected && 'ring-2 ring-sky-400/60'
      )}
    >
      <span
        data-testid="social-mention"
        title={`${node.platform ? CHANNEL_META[node.platform].label : ''} · ${node.providerId ?? ''}`}
      >
        @{node.label}
      </span>
      {props.children}
    </PlateElement>
  )
}

/** The inline, void element social mentions are. */
export const SocialMentionPlugin = createPlatePlugin({
  key: SOCIAL_MENTION,
  node: { component: SocialMentionElement, isElement: true, isInline: true, isVoid: true },
})

/** Put a mention at the caret, then a space after it. */
function insertMention(editor: PlateEditor, channel: DraftChannel, mention: FoundMention) {
  if (!editor.selection) editor.tf.select(editor.api.end([]))
  editor.tf.insertNodes({
    children: [{ text: '' }],
    handle: mention.handle,
    label: mention.label,
    kind: mention.kind,
    platform: channel,
    providerId: mention.providerId,
    type: SOCIAL_MENTION,
  })
  editor.tf.move({ unit: 'offset' })
  editor.tf.insertText(' ')
  editor.tf.focus()
}

/**
 * The mention picker: look an account up on X or LinkedIn with the set's
 * own account and put it in the post. LinkedIn people cannot be looked up
 * through this connection, which it says rather than offering a guess.
 */
export function MentionPicker({
  channels,
  editor,
  setId,
}: {
  channels: DraftChannel[]
  editor: React.MutableRefObject<PlateEditor | null>
  setId: string | null
}) {
  const lookups = channels.filter(
    (channel): channel is 'x' | 'linkedin' => channel === 'x' || channel === 'linkedin'
  )
  const [open, setOpen] = React.useState(false)
  const [channel, setChannel] = React.useState<'x' | 'linkedin'>(lookups[0] ?? 'x')
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<FoundMention[] | null>(null)
  const [busy, setBusy] = React.useState(false)
  if (!setId || lookups.length === 0) return null
  const search = async (term = query) => {
    if (!term.trim() && channel !== 'linkedin') return
    setBusy(true)
    try {
      const found = await call<{ items: FoundMention[] }>(
        `/api/v1/social-sets/${encodeURIComponent(setId)}/mentions?${new URLSearchParams({ channel, q: term.trim() })}`
      )
      setResults(found.items)
    } catch (error) {
      setResults(null)
      toast.error(error instanceof Error ? error.message : 'The lookup did not work.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setResults(null)
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button
          aria-label="Add mention"
          className="h-7 rounded-md px-2 text-sm"
          size={null}
          title="Add mention"
          type="button"
          variant="ghost"
        >
          @
        </Button>
      </PopoverTrigger>
      <PopoverContent className="grid w-80 gap-2 p-3" data-testid="mention-picker" side="top">
        <div className="flex gap-1">
          {lookups.map((item) => (
            <Button
              aria-pressed={item === channel}
              className={cn(
                'h-7 gap-1 px-2 text-xs',
                item === channel && 'bg-white/[0.08] text-white'
              )}
              key={item}
              onClick={() => {
                setChannel(item)
                setResults(null)
              }}
              size={null}
              type="button"
              variant="ghost"
            >
              <ChannelIcon channel={item} />
              {CHANNEL_META[item].label}
            </Button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void search()
          }}
        >
          <Input
            aria-label="Mention lookup"
            autoFocus
            className="h-8 text-sm"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              channel === 'x' ? 'X username, e.g. @jack' : 'Company page, e.g. acme or its URL'
            }
            value={query}
          />
          <Button disabled={busy || !query.trim()} size="sm" type="submit">
            Find
          </Button>
        </form>
        <p className="text-[11px] text-neutral-400">
          {channel === 'x'
            ? 'Looked up on X with this set’s account, by exact username.'
            : 'Company pages only: LinkedIn does not let this connection look people up. Elsewhere the mention is written as the plain name.'}
        </p>
        {channel === 'linkedin' ? (
          <Button disabled={busy} variant="ghost" size="sm" onClick={() => void search('')}>
            Recently mentioned companies
          </Button>
        ) : null}
        {results?.length === 0 ? (
          <p className="text-xs text-neutral-400">No account by that name.</p>
        ) : null}
        {results && results.length > 0 ? (
          <ul className="grid gap-1">
            {results.map((mention) => (
              <li key={mention.providerId}>
                <Button
                  className="flex h-auto w-full items-center justify-start gap-2 px-2 py-1.5 text-left text-sm"
                  data-testid="mention-result"
                  onClick={() => {
                    if (editor.current) insertMention(editor.current, channel, mention)
                    setOpen(false)
                    setQuery('')
                    setResults(null)
                  }}
                  size={null}
                  type="button"
                  variant="ghost"
                >
                  {mention.image ? (
                    // biome-ignore lint/performance/noImgElement: a provider avatar URL
                    <img alt="" className="size-6 rounded-full" src={mention.image} />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">
                    {mention.label}
                    <span className="ml-1 text-neutral-400">
                      {mention.handle
                        ? `@${mention.handle}`
                        : mention.kind === 'organization'
                          ? 'Company page'
                          : ''}
                    </span>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
