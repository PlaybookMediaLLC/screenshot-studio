'use client'

import { useEffect, useState } from 'react'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { CanvasIcon as StackIcon, GridIcon } from '@/components/platform-shell/icons'
import { CanvasPages } from './CanvasPages'
import { EmptyState } from '@/components/platform-ui'
import { PageSpread, type SpreadPage } from '@/components/platform-ui/page-spread'
import { Stage } from '@/components/platform-landing/primitives'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { MoreIcon as MoreHorizontalIcon } from '@/components/platform-shell/icons'
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
    pages: [{ kind: 'blank', ratio: '16:9' }],
    add: true,
  },
  {
    href: '/canvas/new?start=screenshots',
    title: 'From product screenshots',
    detail: 'Drop in screens, get editable announcements.',
    pages: [
      { kind: 'screen', ratio: '16:9' },
      { kind: 'hero', ratio: '1:1' },
      { kind: 'phone', ratio: '9:16' },
    ],
  },
  {
    href: '/canvas/new?start=feature',
    title: 'Announce a shipped feature',
    detail: 'Quoted from a release, with its screenshots.',
    pages: [
      { kind: 'hero', ratio: '16:9' },
      { kind: 'quote', ratio: '4:5' },
    ],
    add: true,
  },
  {
    href: '/canvas/new?start=template',
    title: 'Start from a template',
    detail: 'Walkthroughs, comparisons, explainers, social packs.',
    pages: [
      { kind: 'screen', ratio: '4:3' },
      { kind: 'chart', ratio: '1:1' },
      { kind: 'doc', ratio: '4:5' },
    ],
  },
  {
    href: '/canvas/new?recipe=product-launch',
    title: 'Product launch presentation',
    detail: 'Five artboards from problem to call to action.',
    pages: (['hero', 'quote', 'screen', 'chart', 'cta'] as const).map((kind) => ({
      kind,
      ratio: '16:9',
    })),
  },
] satisfies { href: string; title: string; detail: string; pages: SpreadPage[]; add?: boolean }[]

/**
 * A canvas's cover: one artboard at a time, with Canva-style page tabs to show
 * the others in place when it has several. The tabs sit above the card's link.
 */
function CanvasCover({ item, onManage }: { item: Item; onManage?: () => void }) {
  const artboards = item.document?.artboards ?? []
  const [chosen, setPage] = useState(0)
  // A save elsewhere can leave fewer pages than the one last shown.
  const page = Math.min(chosen, Math.max(artboards.length - 1, 0))
  // Five tabs fit; past that, the last steps through the remaining artboards.
  const tabs = artboards.length > 5 ? 4 : artboards.length
  return (
    <>
      <ProjectPreview
        className="studio-cover"
        retryable
        alt={artboards.length > 1 ? `${item.name}, artboard ${page + 1}` : item.name}
        document={artboards[page]?.document ?? null}
      />
      <span aria-hidden="true" className="studio-shot-overlay">
        {item.name}
      </span>
      {artboards.length > 1 || (onManage && artboards.length) ? (
        <span className="studio-pages" role="group" aria-label={`${item.name} artboards`}>
          {artboards.slice(0, tabs).map((artboard, index) => (
            <Button
              variant="custom"
              size={null}
              aria-label={`Show artboard ${index + 1} of ${artboards.length}`}
              aria-pressed={page === index}
              key={artboard.id}
              onClick={() => setPage(index)}
              onFocus={() => setPage(index)}
              onPointerEnter={() => setPage(index)}
              type="button"
            >
              {index + 1}
            </Button>
          ))}
          {artboards.length > tabs ? (
            <Button
              variant="custom"
              size={null}
              aria-label={`Show the next of ${artboards.length - tabs} more artboards`}
              aria-pressed={page >= tabs}
              onClick={() => setPage(page >= tabs && page < artboards.length - 1 ? page + 1 : tabs)}
              type="button"
            >
              {page >= tabs ? page + 1 : `+${artboards.length - tabs}`}
            </Button>
          ) : null}
          {onManage ? (
            <Button
              variant="custom"
              size={null}
              aria-label={`Manage the pages of ${item.name}`}
              className="studio-pages-manage"
              onClick={onManage}
              title="Pages"
              type="button"
            >
              <GridIcon size={13} aria-hidden="true" />
            </Button>
          ) : null}
        </span>
      ) : null}
    </>
  )
}

export function CanvasLibrary({
  embedded = false,
  canEdit,
  storySetsEnabled,
  campaignsEnabled,
}: {
  embedded?: boolean
  canEdit: boolean
  storySetsEnabled: boolean
  campaignsEnabled: boolean
}) {
  const Root = embedded ? 'section' : 'main'
  const Heading = embedded ? 'h2' : 'h1'
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
  const [managing, setManaging] = useState<Item | null>(null)
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
    <Root className={embedded ? 'w-full space-y-8' : 'w-full space-y-8 p-8'}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="platform-eyebrow mb-2">Infinite canvas</p>
          <Heading className="text-3xl font-normal tracking-tight">Canvas</Heading>
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
        <section aria-label="Start something" className="grid gap-5">
          <ul className="studio-grid studio-grid-compact">
            {ENTRY_POINTS.map((entry, index) => (
              <li className="studio-shot" key={entry.href}>
                <Link
                  href={entry.href}
                  className="block rounded-[10px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                >
                  {/* What the start makes, page by page, on the landing page's stage. */}
                  <span className="studio-shot-media">
                    <Stage className="size-full rounded-none" variant={index}>
                      <PageSpread add={'add' in entry && entry.add} pages={entry.pages} />
                    </Stage>
                  </span>
                  <span className="studio-shot-meta">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{entry.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {entry.detail}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
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
        <EmptyState
          icon={StackIcon}
          title={
            search ? 'No matching canvases' : archived ? 'No archived canvases' : 'No canvases yet'
          }
          description={
            search
              ? 'No canvas matches that name.'
              : archived
                ? 'Archived canvases appear here.'
                : 'Start with a blank canvas or a screenshot, then lay out artboards and layers.'
          }
          action={
            search || archived || !canEdit ? null : (
              <ButtonLink href="/canvas/new">New canvas</ButtonLink>
            )
          }
        />
      ) : null}
      <ul aria-label="Canvases" className="studio-grid">
        {items.map((item) => (
          <li
            key={item.id}
            className={
              (item.document?.artboards.length ?? 0) > 1 ? 'studio-shot studio-stack' : 'studio-shot'
            }
          >
            <div className="studio-shot-media">
              <CanvasCover
                item={item}
                onManage={canEdit && item.document ? () => setManaging(item) : undefined}
              />
              <Link
                aria-hidden="true"
                className="absolute inset-0 z-[2]"
                href={`/canvas/${item.id}`}
                tabIndex={-1}
              />
            </div>
            <div className="studio-shot-meta items-start">
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-medium">
                  <Link href={`/canvas/${item.id}`}>{item.name}</Link>
                </h2>
                <p className="truncate text-xs text-muted-foreground">
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
                    {item.document ? (
                      <DropdownMenuItem onSelect={() => setManaging(item)}>
                        Manage pages…
                      </DropdownMenuItem>
                    ) : null}
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
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(item)}>
                      Delete permanently…
                    </DropdownMenuItem>
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

      {managing?.document ? (
        <CanvasPages
          canvas={{ ...managing, document: managing.document }}
          onClose={() => setManaging(null)}
          onSaved={() => {
            setManaging(null)
            setRefresh((value) => value + 1)
          }}
        />
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
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setDeleting(null)
          }}
        >
          <DialogContent>
            <DialogTitle>Delete “{deleting.name}” permanently?</DialogTitle>
            <DialogDescription>
              This removes the canvas and all its versions. Delivered campaign assets remain
              available. This cannot be undone.
            </DialogDescription>
            <div className="flex justify-end gap-2">
              <Button disabled={busy} variant="outline" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                variant="destructive"
                onClick={() =>
                  void act(async () => {
                    await client.canvas.delete.mutate({ canvasId: deleting.id })
                    setDeleting(null)
                    toast.success('Canvas deleted')
                  })
                }
              >
                Delete permanently
              </Button>
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
    </Root>
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
