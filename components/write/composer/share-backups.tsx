'use client'

import { useWriteRouter } from '@/components/write/write-context'

import * as React from 'react'
import { toast } from 'sonner'
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
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { CHANNEL_META, ChannelIcon } from '@/components/drafts/channel-meta'
import { LocalTime, useHydrated } from '@/components/drafts/local-time'
import { type DraftWire, draftsApi, type RevisionWire } from '@/lib/content-drafts/client'
import { serializeDraft } from '@/lib/content-drafts/serialize'
import { writeApi } from '@/lib/write/client'
import type { DraftChannel, PlateBody } from '@/lib/write/document'
import { bodyFor, readVersions } from '@/lib/write/versions'
import { cn } from '@/lib/utils'
import { draftHref, useWrite } from '../write-context'

/**
 * Share & collaborate (RFC 025): the internal link, which only members who
 * can see the set can open, and the public link, an explicit switch that
 * gives anyone with it read and comment access until it is turned off.
 * Copying the internal link never turns the public one on.
 */
export function ShareDialog({
  canEdit,
  draft,
  onClose,
  onDraft,
}: {
  canEdit: boolean
  draft: DraftWire
  onClose: () => void
  onDraft: (draft: DraftWire) => void
}) {
  const { data } = useWrite()
  const hydrated = useHydrated()
  const [busy, setBusy] = React.useState(false)
  const set = data.sets.find(
    (item) =>
      item.id ===
      (draft.socialSetId ?? data.sets.find((entry) => entry.visibility === 'WORKSPACE')?.id)
  )
  const internal = hydrated ? `${window.location.origin}${draftHref(draft.id, set?.id)}` : ''
  const publicLink =
    hydrated && draft.shareToken ? `${window.location.origin}/d/${draft.shareToken}` : ''
  const toggle = async (enabled: boolean) => {
    setBusy(true)
    try {
      onDraft(await draftsApi.share(draft.id, enabled))
      toast.success(enabled ? 'Public link on.' : 'Public link off. It stops working now.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sharing did not change.')
    } finally {
      setBusy(false)
    }
  }
  const copy = (value: string, done: string) => {
    void navigator.clipboard.writeText(value)
    toast.success(done)
  }
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent className="max-w-md" data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle>Share & collaborate</DialogTitle>
          <DialogDescription>
            {set?.visibility === 'PRIVATE'
              ? `Access: ${set.name} is private to its owner.`
              : 'Access: everyone in this workspace, by their role.'}
          </DialogDescription>
        </DialogHeader>
        <Label className="grid gap-1 text-xs text-neutral-400">
          Internal link
          <span className="flex gap-2">
            <Input
              aria-label="Internal link"
              className="flex-1 text-xs"
              readOnly
              value={internal}
            />
            <Button
              onClick={() =>
                copy(internal, 'Internal link copied. Members who can see this set can open it.')
              }
              size="sm"
              type="button"
              variant="outline"
            >
              Copy link
            </Button>
          </span>
        </Label>
        <div className="grid gap-2 rounded-lg border border-white/[0.06] p-3">
          <Label className="flex items-center justify-between gap-3 text-sm text-neutral-200">
            <span>
              Public link
              <span className="block text-[11px] text-neutral-400">
                Anyone with the link can read this draft and comment, without signing in.
              </span>
            </span>
            <Switch
              aria-label="Public link"
              checked={Boolean(draft.shareToken)}
              disabled={!canEdit || busy}
              onCheckedChange={(checked) => void toggle(checked === true)}
            />
          </Label>
          {publicLink ? (
            <span className="flex gap-2">
              <Input
                aria-label="Public link to share"
                className="flex-1 text-xs"
                readOnly
                value={publicLink}
              />
              <Button
                onClick={() => copy(publicLink, 'Public link copied.')}
                size="sm"
                type="button"
                variant="outline"
              >
                Copy
              </Button>
            </span>
          ) : (
            <p className="text-xs text-neutral-400">
              Off: nobody outside the workspace can open this draft.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose} type="button">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Line diff of two texts: kept, removed and added lines, in order (LCS). */
export function lineDiff(
  before: string,
  after: string
): { kind: 'same' | 'removed' | 'added'; text: string }[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const out: { kind: 'same' | 'removed' | 'added'; text: string }[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ kind: 'removed', text: a[i] })
      i += 1
    } else {
      out.push({ kind: 'added', text: b[j] })
      j += 1
    }
  }
  while (i < a.length) out.push({ kind: 'removed', text: a[i++] })
  while (j < b.length) out.push({ kind: 'added', text: b[j++] })
  return out
}

/** Why a backup was kept, as a person reads it. */
const REASONS: Record<RevisionWire['reason'], string> = {
  edit: 'While editing',
  plan: 'When planned',
  publish: 'When published',
  recovery: 'When recovered',
  schedule: 'When scheduled',
}

/**
 * Automatic backups (RFC 025): immutable snapshots, browsed one at a time
 * with previous and next, shown per platform, compared with the draft now,
 * and recovered as a new draft. The draft itself is never changed here.
 */
export function BackupsBrowser({
  channels,
  current,
  draftId,
  onClose,
}: {
  channels: DraftChannel[]
  current: PlateBody
  draftId: string
  onClose: () => void
}) {
  const router = useWriteRouter()
  const { data } = useWrite()
  const [items, setItems] = React.useState<RevisionWire[] | null>(null)
  const [index, setIndex] = React.useState(0)
  const [revision, setRevision] = React.useState<RevisionWire | null>(null)
  const [channel, setChannel] = React.useState<DraftChannel>(channels[0] ?? 'x')
  const [compare, setCompare] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    void draftsApi
      .revisions(draftId)
      .then(({ items: found }) => setItems(found))
      .catch((error: unknown) => {
        setItems([])
        toast.error(error instanceof Error ? error.message : 'Backups could not be read.')
      })
  }, [draftId])
  const id = items?.[index]?.id
  React.useEffect(() => {
    if (!id) return setRevision(null)
    let live = true
    void draftsApi.revision(draftId, id).then((found) => live && setRevision(found))
    return () => {
      live = false
    }
  }, [draftId, id])
  const body = revision
    ? bodyFor((revision.body ?? []) as PlateBody, readVersions(revision.platformVersions), channel)
    : []
  const then = serializeDraft(body, channel).caption
  const now = serializeDraft(current, channel).caption
  const recover = async () => {
    if (!id) return
    setBusy(true)
    try {
      const result = await writeApi.recover(draftId, id)
      toast.success('Recovered as a new draft. The original is unchanged.')
      router.push(draftHref(result.draft.id, data.activeSet?.id))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The backup could not be recovered.')
      setBusy(false)
    }
  }
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent
        className="max-h-[90dvh] max-w-2xl overflow-y-auto"
        data-testid="backups-browser"
      >
        <DialogHeader>
          <DialogTitle>Browse versions</DialogTitle>
          <DialogDescription>
            Backups are kept every ten minutes while you edit, and whenever the draft is planned,
            scheduled, published or recovered: every one from the last 30 days, then one a day for a
            year. Recovering makes a new draft; this one stays as it is.
          </DialogDescription>
        </DialogHeader>
        {items === null ? <p className="text-sm text-neutral-400">Loading…</p> : null}
        {items?.length === 0 ? (
          <p className="text-sm text-neutral-400">No backups yet: they start with edits.</p>
        ) : null}
        {items && items.length > 0 ? (
          <>
            <div className="flex items-center justify-between gap-2 text-sm">
              <Button
                disabled={index >= items.length - 1}
                onClick={() => setIndex(index + 1)}
                size="sm"
                type="button"
                variant="outline"
              >
                ← Prev
              </Button>
              <span className="text-center text-xs text-neutral-400" data-testid="backup-time">
                <LocalTime value={items[index].createdAt} /> · version {items[index].version} ·{' '}
                {REASONS[items[index].reason]}
                <span className="block text-[11px] text-neutral-600">
                  {index + 1} of {items.length}
                </span>
              </span>
              <Button
                disabled={index === 0}
                onClick={() => setIndex(index - 1)}
                size="sm"
                type="button"
                variant="outline"
              >
                Next →
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {channels.map((item) => (
                <Button
                  aria-pressed={item === channel}
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                    item === channel
                      ? 'border-white/30 text-white'
                      : 'border-white/10 text-neutral-400'
                  )}
                  key={item}
                  onClick={() => setChannel(item)}
                  size={null}
                  type="button"
                  variant="custom"
                >
                  <ChannelIcon channel={item} />
                  {CHANNEL_META[item].label}
                </Button>
              ))}
              <Label className="ml-auto flex items-center gap-2 text-xs text-neutral-400">
                Compare with now
                <Switch
                  aria-label="Compare with now"
                  checked={compare}
                  onCheckedChange={(checked) => setCompare(checked === true)}
                />
              </Label>
            </div>
            {revision ? (
              compare ? (
                <pre
                  className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white/[0.03] p-3 font-sans text-sm"
                  data-testid="backup-diff"
                >
                  {lineDiff(then, now).map((line, at) => (
                    <span
                      className={cn(
                        'block',
                        line.kind === 'removed' && 'bg-red-500/15 text-red-200 line-through',
                        line.kind === 'added' && 'bg-emerald-500/15 text-emerald-200'
                      )}
                      key={at}
                    >
                      {line.kind === 'removed' ? '− ' : line.kind === 'added' ? '+ ' : '  '}
                      {line.text || ' '}
                    </span>
                  ))}
                </pre>
              ) : (
                <pre
                  className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white/[0.03] p-3 font-sans text-sm text-neutral-200"
                  data-testid="backup-content"
                >
                  {then || 'Empty'}
                </pre>
              )
            ) : (
              <p className="text-sm text-neutral-400">Loading this version…</p>
            )}
          </>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="ghost">
            Close
          </Button>
          <Button disabled={!id || busy} onClick={() => void recover()} type="button">
            Create new draft from this version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
