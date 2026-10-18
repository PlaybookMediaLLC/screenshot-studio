'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { NoteEditIcon } from 'hugeicons-react'
import { toast } from 'sonner'
import { EmptyState, Group, Pill, type PillTone } from '@/components/platform-ui'
import { Button } from '@/components/ui/button'
import { draftsApi } from '@/lib/content-drafts/client'

export type DraftListItem = {
  excerpt: string
  id: string
  status: 'draft' | 'scheduled' | 'archived'
  title: string
  updatedAt: string
}

const STATUS_TONES: Record<DraftListItem['status'], PillTone> = {
  archived: 'gray',
  draft: 'yellow',
  scheduled: 'green',
}

/** The workspace's drafts, newest first, and a button to start one. */
export function DraftList({ canEdit, drafts }: { canEdit: boolean; drafts: DraftListItem[] }) {
  const router = useRouter()
  const [creating, setCreating] = React.useState(false)
  const create = async () => {
    setCreating(true)
    try {
      const draft = await draftsApi.create()
      router.push(`/drafts/${draft.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The draft could not be created.')
      setCreating(false)
    }
  }
  const newDraft = canEdit ? (
    <Button disabled={creating} onClick={create}>
      New draft
    </Button>
  ) : null

  if (drafts.length === 0) {
    return (
      <EmptyState
        action={newDraft}
        description="Write a post by hand, save it, and schedule it to one or more of your channels."
        icon={NoteEditIcon}
        title="No drafts yet"
      />
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{newDraft}</div>
      <Group>
        {drafts.map((draft) => (
          <Link
            className="flex items-center justify-between gap-4 p-5 hover:bg-white/[0.03]"
            href={`/drafts/${draft.id}`}
            key={draft.id}
          >
            <div className="min-w-0">
              <h3 className="truncate text-sm font-medium text-white">{draft.title}</h3>
              <p className="mt-0.5 truncate text-xs text-neutral-500">
                {draft.excerpt || 'Empty draft'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs text-neutral-500">
                {new Date(draft.updatedAt).toLocaleDateString()}
              </span>
              <Pill tone={STATUS_TONES[draft.status]}>{draft.status}</Pill>
            </div>
          </Link>
        ))}
      </Group>
    </div>
  )
}
