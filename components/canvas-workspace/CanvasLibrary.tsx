'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { MoreHorizontalIcon } from 'hugeicons-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ProjectPreview } from '@/components/projects/ProjectPreview'
import { usePrivateCreativeSurface } from '@/components/creative-sets/use-private-surface'
import { useTRPCClient } from '@/lib/trpc/react'
import type { CanvasDocument } from '@/lib/canvas/document'
import type { CreativeSetSort } from '@/lib/creative-sets/schema'

type Item = Awaited<
  ReturnType<ReturnType<typeof useTRPCClient>['canvas']['list']['query']>
>['items'][number]

/** Where a canvas's artboards came from, for the library card. */
function lineage(document: CanvasDocument | null): string[] {
  if (!document) return []
  const kinds = new Set(document.artboards.map((artboard) => artboard.origin?.kind).filter(Boolean))
  const labels: string[] = []
  if (kinds.has('story-set')) labels.push('From a Story Set')
  if (kinds.has('design')) labels.push('From a campaign')
  if (kinds.has('project')) labels.push('From a project')
  if (
    document.context.releaseId ||
    document.artboards.some((artboard) => artboard.context?.releaseId)
  )
    labels.push('Release-linked')
  return labels
}

const ENTRY_POINTS = [
  {
    href: '/canvas/new?blank=1',
    title: 'Blank canvas',
    detail: 'One 16:9 artboard, nothing to configure.',
  },
  {
    href: '/canvas/new?start=screenshots',
    title: 'From product screenshots',
    detail: 'Drop in screens, get editable announcements.',
  },
  {
    href: '/canvas/new?start=feature',
    title: 'Announce a shipped feature',
    detail: 'Quoted from a release, with its screenshots.',
  },
  {
    href: '/canvas/new?start=template',
    title: 'Start from a template',
    detail: 'Walkthroughs, comparisons, explainers, social packs.',
  },
  {
    href: '/canvas/new?recipe=product-launch',
    title: 'Product launch presentation',
    detail: 'Five artboards from problem to call to action.',
  },
] as const

export function CanvasLibrary({
  canEdit,
  storySetsEnabled,
  campaignsEnabled,
}: {
  canEdit: boolean
  storySetsEnabled: boolean
  campaignsEnabled: boolean
}) {
  usePrivateCreativeSurface()
  const client = useTRPCClient()
  const [items, setItems] = useState<Item[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const params = useSearchParams()
  const search = (params.get('search') ?? '').slice(0, 200)
  const sort: CreativeSetSort = params.get('sort') === 'name' ? 'name' : 'updated'
  const archived = params.get('view') === 'archived'
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [renaming, setRenaming] = useState<Item | null>(null)
  const [deleting, setDeleting] = useState<Item | null>(null)
  const [archiving, setArchiving] = useState<Item | null>(null)
  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      setLoading(true)
      client.canvas.list
        .query({ search: search || undefined, sort, archived, limit: 24 })
        .then(
          (page) => {
            if (!active) return
            setItems(page.items)
            setCursor(page.nextCursor)
            setError(null)
          },
          (error: unknown) => {
            if (active)
              setError(error instanceof Error ? error.message : 'Could not load canvases.')
          }
        )
        .finally(() => {
          if (active) setLoading(false)
        })
    }, 200)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [client, search, sort, archived, refresh])

  function filter(key: string, value: string) {
    const url = new URL(window.location.href)
    if (value) url.searchParams.set(key, value)
    else url.searchParams.delete(key)
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  }

  async function act(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      setError(null)
      setRefresh((value) => value + 1)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="w-full space-y-8 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.16em] text-sky-400">Infinite canvas</p>
          <h1 className="text-3xl font-semibold tracking-tight">Canvas</h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Lay out a whole launch on one board: announcements, social formats, walkthroughs and
            diagrams, each an editable artboard that exports at its exact size.
          </p>
        </div>
        {canEdit ? (
          <Button asChild>
            <Link href="/canvas/new">New canvas</Link>
          </Button>
        ) : null}
      </header>

      {canEdit ? (
        <section aria-label="Start something" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {ENTRY_POINTS.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              className="rounded-xl border p-4 transition-colors hover:bg-foreground/[0.03] focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="block text-sm font-medium">{entry.title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{entry.detail}</span>
            </Link>
          ))}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm sm:col-span-2 xl:col-span-5">
            <span className="text-muted-foreground">Bring existing work:</span>
            <Link className="underline-offset-4 hover:underline" href="/canvas/new?start=project">
              Import a project
            </Link>
            <Link className="underline-offset-4 hover:underline" href="/canvas/new?start=story-set">
              Open a Story Set{storySetsEnabled ? '' : ' (saved sets)'}
            </Link>
            {campaignsEnabled ? (
              <Link
                className="underline-offset-4 hover:underline"
                href="/canvas/new?start=campaign"
              >
                Edit a campaign creative
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label="Search canvases"
          placeholder="Search canvases"
          value={search}
          onChange={(event) => filter('search', event.target.value)}
          maxLength={200}
          className="max-w-sm"
        />
        <Select
          value={sort}
          onValueChange={(value) => filter('sort', value === 'name' ? 'name' : '')}
        >
          <SelectTrigger aria-label="Sort canvases">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">Last edited</SelectItem>
            <SelectItem value="name">Name</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={archived ? 'archived' : 'active'}
          onValueChange={(value) => filter('view', value === 'archived' ? 'archived' : '')}
        >
          <SelectTrigger aria-label="Canvas view">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active canvases</SelectItem>
            <SelectItem value="archived">Archived canvases</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!loading && !items.length ? (
        <p className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          {search
            ? 'No canvas matches that name.'
            : archived
              ? 'No archived canvases.'
              : 'No canvases yet. Start with a blank canvas or a screenshot.'}
        </p>
      ) : null}
      <ul aria-label="Canvases" className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <li key={item.id} className="overflow-hidden rounded-xl border bg-foreground/[0.02]">
            <Link
              href={`/canvas/${item.id}`}
              className="block focus-visible:outline-2 focus-visible:outline-ring"
            >
              <div className="aspect-video">
                <ProjectPreview
                  alt={item.name}
                  document={item.document?.artboards[0]?.document ?? null}
                />
              </div>
            </Link>
            <div className="flex items-start gap-2 p-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-medium">
                  <Link href={`/canvas/${item.id}`}>{item.name}</Link>
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.document
                    ? `${item.document.artboards.length} artboard${item.document.artboards.length === 1 ? '' : 's'}`
                    : 'Saved by a newer version'}{' '}
                  · Edited{' '}
                  {item.updatedAt.toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
                {lineage(item.document).length ? (
                  <p className="mt-2 flex flex-wrap gap-1">
                    {lineage(item.document).map((label) => (
                      <span
                        key={label}
                        className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {label}
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
              {canEdit ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={`Actions for ${item.name}`}
                    >
                      <MoreHorizontalIcon className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link href={`/canvas/${item.id}`}>Open</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setRenaming(item)}>Rename…</DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        void act(async () => {
                          const copy = await client.canvas.duplicate.mutate({
                            canvasId: item.id,
                            name: `${item.name.slice(0, 193)} (copy)`,
                          })
                          toast.success(`Created “${copy.name}”.`)
                        })
                      }
                    >
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {archived ? (
                      <DropdownMenuItem
                        onSelect={() =>
                          void act(async () => {
                            await client.canvas.archive.mutate({
                              canvasId: item.id,
                              archived: false,
                            })
                            toast.success(`Restored “${item.name}” to active canvases.`)
                          })
                        }
                      >
                        Restore to active canvases
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem variant="destructive" onSelect={() => setArchiving(item)}>
                        Archive…
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(item)}>Delete permanently…</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {cursor ? (
        <Button
          variant="outline"
          onClick={() =>
            void client.canvas.list
              .query({ search: search || undefined, sort, archived, cursor, limit: 24 })
              .then((page) => {
                setItems((previous) => [...previous, ...page.items])
                setCursor(page.nextCursor)
              })
          }
        >
          Load more
        </Button>
      ) : null}

      {renaming ? (
        <RenameDialog
          name={renaming.name}
          onClose={() => setRenaming(null)}
          onSave={(name) =>
            act(async () => {
              await client.canvas.rename.mutate({ canvasId: renaming.id, name })
              setRenaming(null)
            })
          }
        />
      ) : null}
      {deleting ? (
        <Dialog open onOpenChange={(open) => { if (!open && !busy) setDeleting(null) }}>
          <DialogContent>
            <DialogTitle>Delete “{deleting.name}” permanently?</DialogTitle>
            <DialogDescription>This removes the canvas and all its versions. Delivered campaign assets remain available. This cannot be undone.</DialogDescription>
            <div className="flex justify-end gap-2">
              <Button disabled={busy} variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button disabled={busy} variant="destructive" onClick={() => void act(async () => {
                await client.canvas.delete.mutate({ canvasId: deleting.id })
                setDeleting(null)
                toast.success('Canvas deleted')
              })}>Delete permanently</Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
      {archiving ? (
        <Dialog open onOpenChange={(open) => (open ? null : setArchiving(null))}>
          <DialogContent>
            <DialogTitle>Archive “{archiving.name}”?</DialogTitle>
            <DialogDescription>
              It moves to Archived canvases, where you can restore it at any time. Its versions and
              campaign deliveries stay intact.
            </DialogDescription>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setArchiving(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await client.canvas.archive.mutate({ canvasId: archiving.id })
                    const item = archiving
                    toast.success(`Archived “${item.name}”.`, {
                      duration: 10000,
                      action: {
                        label: 'Undo',
                        onClick: () =>
                          void act(async () => {
                            await client.canvas.archive.mutate({
                              canvasId: item.id,
                              archived: false,
                            })
                            toast.success(`Restored “${item.name}”.`)
                          }),
                      },
                    })
                    setArchiving(null)
                  })
                }
              >
                Archive
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </main>
  )
}

/** Name entry shared by the library and the open canvas. */
export function RenameDialog({
  name,
  title = 'Rename canvas',
  onSave,
  onClose,
}: {
  name: string
  title?: string
  onSave: (name: string) => Promise<void> | void
  onClose: () => void
}) {
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!value.trim()) return
            setBusy(true)
            try {
              await onSave(value.trim())
            } finally {
              setBusy(false)
            }
          }}
        >
          <Input
            aria-label="Name"
            autoFocus
            value={value}
            maxLength={200}
            onChange={(event) => setValue(event.target.value)}
          />
          <p className="text-right text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {value.length}/200 characters
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !value.trim()}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
