'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Add01Icon } from 'hugeicons-react'
import { toast } from 'sonner'
import { draftsApi } from '@/lib/content-drafts/client'
import { cn } from '@/lib/utils'

export type DraftListItem = {
  excerpt: string
  id: string
  status: 'draft' | 'scheduled' | 'archived'
  title: string
  updatedAt: string
}

const TABS: { label: string; status: DraftListItem['status'] }[] = [
  { label: 'Drafts', status: 'draft' },
  { label: 'Scheduled', status: 'scheduled' },
  { label: 'Archived', status: 'archived' },
]

/** "5m", "3h", "2d", then a date: how long ago a draft was touched. */
function since(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / 60 / 24)}d`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

const RailUpdate = React.createContext<(draft: DraftListItem) => void>(() => {})

/** Lets the open draft keep its line in the list current as it is saved. */
export function useShowInRail() {
  return React.useContext(RailUpdate)
}

/**
 * The drafts page frame: the list of drafts on the left and the open draft,
 * or a hint, filling the rest. Writing stays one click from every draft.
 */
export function DraftsFrame({
  activeId,
  canEdit,
  children,
  drafts,
}: {
  activeId?: string
  canEdit: boolean
  children: React.ReactNode
  drafts: DraftListItem[]
}) {
  const [saved, setSaved] = React.useState<DraftListItem | null>(null)
  const shown = saved ? [saved, ...drafts.filter((draft) => draft.id !== saved.id)] : drafts
  return (
    <div className="flex h-[100dvh] min-h-0 md:h-[calc(100vh-1rem-2px)]">
      <DraftsRail activeId={activeId} canEdit={canEdit} drafts={shown} />
      {/* On a phone the list is the page until a draft is open. */}
      <div
        className={cn('relative min-w-0 flex-1 overflow-y-auto', !activeId && 'hidden md:block')}
      >
        <RailUpdate.Provider value={setSaved}>{children}</RailUpdate.Provider>
      </div>
    </div>
  )
}

function DraftsRail({
  activeId,
  canEdit,
  drafts,
}: {
  activeId?: string
  canEdit: boolean
  drafts: DraftListItem[]
}) {
  const router = useRouter()
  const active = drafts.find((draft) => draft.id === activeId)
  const [tab, setTab] = React.useState<DraftListItem['status']>(active?.status ?? 'draft')
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
  const shown = drafts.filter((draft) => draft.status === tab)

  return (
    <aside
      aria-label="Drafts"
      className={cn(
        'w-full shrink-0 flex-col border-white/[0.06] md:flex md:w-72 md:border-r',
        activeId ? 'hidden' : 'flex'
      )}
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <h1 className="text-sm font-medium text-white">Drafts</h1>
      </div>
      <div className="px-3" role="tablist">
        <div className="grid grid-cols-3 rounded-lg bg-white/[0.04] p-0.5">
          {TABS.map((item) => {
            const count = drafts.filter((draft) => draft.status === item.status).length
            return (
              <button
                aria-selected={tab === item.status}
                className={cn(
                  'rounded-md px-2 py-1 text-xs transition-colors',
                  tab === item.status
                    ? 'bg-white/[0.08] text-white'
                    : 'text-neutral-500 hover:text-neutral-300'
                )}
                key={item.status}
                onClick={() => setTab(item.status)}
                role="tab"
                type="button"
              >
                {item.label}
                {count > 0 ? <span className="ml-1 text-neutral-500">{count}</span> : null}
              </button>
            )
          })}
        </div>
      </div>
      {canEdit ? (
        <button
          className="mx-3 mt-3 flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-neutral-300 transition-colors hover:bg-white/[0.04] hover:text-white disabled:opacity-50"
          disabled={creating}
          onClick={create}
          type="button"
        >
          <Add01Icon aria-hidden className="size-4" />
          New draft
        </button>
      ) : null}
      <nav className="mt-2 min-h-0 flex-1 overflow-y-auto border-t border-white/[0.06]">
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-xs text-neutral-500">
            {tab === 'draft' ? 'No drafts. Start one above.' : `Nothing ${tab}.`}
          </p>
        ) : (
          shown.map((draft) => (
            <Link
              aria-current={draft.id === activeId ? 'page' : undefined}
              className={cn(
                'block border-b border-l-2 border-b-white/[0.04] px-4 py-3 transition-colors',
                draft.id === activeId
                  ? 'border-l-sky-400 bg-white/[0.04]'
                  : 'border-l-transparent hover:bg-white/[0.02]'
              )}
              href={`/drafts/${draft.id}`}
              key={draft.id}
            >
              <p className="line-clamp-2 text-[13px] leading-snug text-neutral-200">
                {draft.excerpt || <span className="text-neutral-500">Empty draft</span>}
              </p>
              <p className="mt-1.5 flex items-center justify-between text-[11px] text-neutral-500">
                <span className="truncate">{draft.title}</span>
                <span className="shrink-0">{since(draft.updatedAt)}</span>
              </p>
            </Link>
          ))
        )}
      </nav>
    </aside>
  )
}
