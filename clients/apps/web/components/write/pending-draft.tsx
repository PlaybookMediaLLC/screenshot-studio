'use client'

import * as React from 'react'
import { draftsApi } from '@/lib/content-drafts/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type PendingDraft = { id?: string; text: string; error?: string }
let pending: PendingDraft | null = null
let retry: (() => Promise<void>) | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function update(value: PendingDraft | null) {
  pending = value
  listeners.forEach((listener) => listener())
}

/** Keep typing in a native field until the new draft's collaboration editor is ready. */
export async function createWritingDraft(
  input: Parameters<typeof draftsApi.create>[0],
  navigate: (id: string) => void,
  beforeLeave?: () => Promise<void>
) {
  if (pending) return
  update({ text: '' })
  retry = async () => {
    if (pending) update({ ...pending, error: undefined })
    try {
      await beforeLeave?.()
      const draft = await draftsApi.create(input)
      update({ id: draft.id, text: pending?.text ?? '' })
      navigate(draft.id)
    } catch (error) {
      update({
        text: pending?.text ?? '',
        error: error instanceof Error ? error.message : 'Could not create the draft.',
      })
    }
  }
  await retry()
}

/** Deliver buffered typing once, after the shared document has initialized. */
export function takePendingDraft(id: string): string | null {
  if (pending?.id !== id) return null
  const text = pending.text
  update(null)
  retry = null
  return text
}

/** A typing surface that remains mounted while the route and editor load. */
export function PendingDraftInput() {
  const value = React.useSyncExternalStore(
    subscribe,
    () => pending,
    () => null
  )
  React.useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (pending?.text) event.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])
  if (!value) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-6">
      <div className="w-full max-w-xl space-y-3">
        <p role="status">{value.error ?? 'New draft · Connecting in the background'}</p>
        <Textarea
          autoFocus
          aria-label="New draft text"
          className="min-h-48"
          placeholder="What would you like to share?"
          value={value.text}
          onChange={(event) => {
            if (pending) update({ ...pending, text: event.target.value })
          }}
        />
        {value.error ? (
          <div className="flex gap-2">
            <Button onClick={() => void retry?.()}>Retry</Button>
            {value.id ? null : (
              // Nothing was created: a refusal (such as no permission to write) must not trap the page.
              <Button
                onClick={() => {
                  retry = null
                  update(null)
                }}
                variant="outline"
              >
                Cancel
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Keep early text available if the collaboration connection needs another attempt. */
export function pendingDraftConnectionError(id: string, reconnect: () => void) {
  if (pending?.id !== id) return
  update({ ...pending, error: 'Could not connect yet. Your text is kept here.' })
  retry = async () => {
    if (pending) update({ ...pending, error: undefined })
    reconnect()
  }
}
