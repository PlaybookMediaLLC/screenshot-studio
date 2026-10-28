'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ContentBatch } from '@/lib/api/contracts/content-batches'
import { call } from '@/lib/content-drafts/client'

/** Start a batch in a publishing brand and open it. */
export function NewBatchButton({
  sets,
  defaultSetId,
}: {
  sets: { id: string; name: string }[]
  defaultSetId?: string
}) {
  const [title, setTitle] = React.useState(() => `Batch ${new Date().toLocaleDateString()}`)
  const [setId, setSetId] = React.useState(
    defaultSetId && sets.some((set) => set.id === defaultSetId) ? defaultSetId : sets[0]?.id
  )
  const [busy, setBusy] = React.useState(false)
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        setBusy(true)
        void call<ContentBatch>('/api/v1/content-batches', {
          method: 'POST',
          body: { title, socialSetId: setId },
        })
          .then((batch) => window.location.assign(`/write/batches/${batch.id}`))
          .catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : 'The batch could not be started.')
            setBusy(false)
          })
      }}
    >
      <label className="grid gap-1 text-sm">
        Name
        <Input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="grid gap-1 text-sm">
        Publishing brand
        <select
          aria-label="Publishing brand"
          className="rounded border bg-background p-2"
          value={setId}
          onChange={(event) => setSetId(event.target.value)}
        >
          {sets.map((set) => (
            <option key={set.id} value={set.id}>
              {set.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" disabled={busy || !title.trim() || !setId}>
        Start a batch
      </Button>
    </form>
  )
}
