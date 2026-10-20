'use client'

import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { experimentListSchema } from '@/lib/api/contracts/settings-platform'
import { type DraftWire, draftsApi } from '@/lib/content-drafts/client'
import { settingsRequest } from '@/lib/settings/client'

/** A datetime-local value for an instant, in the browser's zone. */
function localValue(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Tags and calendar planning on a draft (RFC 043). Both are experiments: the
 * controls show only when the person turned them on and the workspace allows
 * them, and the backend checks the same again on every save.
 */
export function DraftDetails({
  draftId,
  onSaved,
  plannedFor,
  readVersion,
  tags,
}: {
  draftId: string
  onSaved: (draft: DraftWire) => void
  plannedFor: string | null
  /** The draft's current version, read when a save starts. */
  readVersion: () => number
  tags: string[]
}) {
  const experiments = useQuery({
    queryFn: () => settingsRequest('/api/v1/experiments', experimentListSchema),
    queryKey: ['experiments'],
    staleTime: 60_000,
  })
  const enabled = (id: string) => experiments.data?.items.some((item) => item.id === id && item.enabled) ?? false
  const canTag = enabled('draft-tags')
  const canPlan = enabled('draft-planning')
  const [tagText, setTagText] = React.useState(tags.join(', '))
  const [planned, setPlanned] = React.useState(localValue(plannedFor))
  React.useEffect(() => setTagText(tags.join(', ')), [tags])
  React.useEffect(() => setPlanned(localValue(plannedFor)), [plannedFor])
  if (!canTag && !canPlan) return null

  const save = async (input: { plannedFor?: string; tags?: string[] }) => {
    try {
      onSaved(await draftsApi.save(draftId, { baseVersion: readVersion(), ...input }))
      toast.success('Saved.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The draft could not be saved.')
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" type="button" variant="ghost">
          Details
          {tags.length > 0 ? <span className="ml-1 text-muted-foreground">{tags.length}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-80 gap-4 p-4">
        {canTag ? (
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void save({ tags: tagText.split(',').map((tag) => tag.trim()).filter(Boolean) })
            }}
          >
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-foreground">Tags</span>
              <span className="text-xs text-muted-foreground">Comma-separated, up to ten.</span>
              <Input onChange={(event) => setTagText(event.target.value)} placeholder="launch, q4" value={tagText} />
            </label>
            <Button size="sm" type="submit" variant="outline">
              Save tags
            </Button>
          </form>
        ) : null}
        {canPlan ? (
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void save({ plannedFor: planned ? new Date(planned).toISOString() : '' })
            }}
          >
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-foreground">Planned for</span>
              <span className="text-xs text-muted-foreground">A place on the calendar; nothing is scheduled.</span>
              <Input onChange={(event) => setPlanned(event.target.value)} type="datetime-local" value={planned} />
            </label>
            <div className="flex gap-2">
              <Button size="sm" type="submit" variant="outline">
                Save plan
              </Button>
              {plannedFor ? (
                <Button onClick={() => void save({ plannedFor: '' })} size="sm" type="button" variant="ghost">
                  Clear
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
