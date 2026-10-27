'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { draftsApi } from '@/lib/content-drafts/client'

/** Choose an existing draft or repurpose a published one into the selected slot. */
export function CalendarDraftPicker({
  socialSetId,
  onClose,
  onChoose,
  onNew,
}: {
  socialSetId?: string
  onClose: () => void
  onChoose: (id: string) => void
  onNew: () => void
}) {
  const [view, setView] = React.useState<'drafts' | 'posted'>('drafts')
  const [items, setItems] = React.useState<{ id: string; title: string; plainText: string }[]>([])
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [search, setSearch] = React.useState('')
  React.useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const query = new URLSearchParams({ view, limit: '100', search })
    if (socialSetId) query.set('socialSetId', socialSetId)
    const timer = setTimeout(() => {
      void fetch(`/api/v1/content-drafts?${query}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error('Drafts could not be loaded.')
          const body = (await response.json()) as { items: typeof items }
          setItems(body.items)
          setLoading(false)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setError(error instanceof Error ? error.message : 'Drafts could not be loaded.')
          setLoading(false)
        })
    }, 150)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [view, socialSetId, search])
  const choose = async (id: string) => {
    setBusy(true)
    try {
      if (view === 'posted') {
        const draft = await draftsApi.create({
          kind: 'repurpose',
          socialSetId,
          target: { sourceDraftId: id },
        })
        onChoose(draft.id)
      } else {
        await draftsApi.get(id)
        onChoose(id)
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'This draft is unavailable.')
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pick content for this slot</DialogTitle>
          <DialogDescription>
            Review the draft and confirm its time before it is scheduled.
          </DialogDescription>
        </DialogHeader>
        <select
          aria-label="Content to pick"
          value={view}
          onChange={(event) => setView(event.target.value as typeof view)}
          disabled={busy}
          className="rounded border bg-background p-2"
        >
          <option value="drafts">Existing drafts</option>
          <option value="posted">Repurpose published posts</option>
        </select>
        <input
          aria-label="Find content for slot"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search title or text"
          className="rounded border bg-background p-2"
        />
        {error ? (
          <p role="alert">{error}</p>
        ) : loading ? (
          <p role="status">Loading…</p>
        ) : (
          <ul className="max-h-72 overflow-auto">
            {items.map((item) => (
              <li key={item.id}>
                <Button
                  variant="ghost"
                  className="w-full justify-start truncate"
                  disabled={busy}
                  onClick={() => void choose(item.id)}
                >
                  {item.title || item.plainText.slice(0, 80) || 'Untitled draft'}
                </Button>
              </li>
            ))}
            {!items.length ? <li>No matching content.</li> : null}
          </ul>
        )}
        <Button variant="outline" disabled={busy} onClick={onNew}>
          Write a new draft
        </Button>
      </DialogContent>
    </Dialog>
  )
}
