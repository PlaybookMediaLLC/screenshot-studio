'use client'

import { useState, type DragEvent } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  AddIcon,
  ArrowBackIcon,
  ArrowForwardIcon,
  CopyIcon,
  DeleteIcon,
  DragIcon,
} from '@/components/platform-shell/icons'
import { ProjectPreview } from '@/components/projects/ProjectPreview'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  artboardRect,
  canvasDocumentSchema,
  type Artboard,
  type CanvasDocument,
} from '@/lib/canvas/document'
import { nextArtboardPosition } from '@/lib/canvas/layout'
import { blankArtboard } from '@/lib/canvas/recipes'
import { useTRPCClient } from '@/lib/trpc/react'
import { cn } from '@/lib/utils'

/** Height every page thumbnail shares, so pages of different shapes line up. */
const TILE = 132

/**
 * A canvas's pages as a grid, Canva-style: drag a page (or use its arrows) to
 * reorder, duplicate or delete it, or add a blank page the size of the last.
 * Page order is the artboards' order, which printing and covers follow.
 * Nothing is written until Save, which is refused if the canvas changed since.
 */
export function CanvasPages({
  canvas,
  onClose,
  onSaved,
}: {
  canvas: { id: string; name: string; revision: number; document: CanvasDocument }
  onClose: () => void
  onSaved: () => void
}) {
  const client = useTRPCClient()
  const [pages, setPages] = useState<Artboard[]>(canvas.document.artboards)
  const [dragging, setDragging] = useState<number | null>(null)
  // Where a dragged page would land: the index it would be inserted before.
  const [target, setTarget] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const changed =
    pages.length !== canvas.document.artboards.length ||
    pages.some((page, index) => page !== canvas.document.artboards[index])

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= pages.length) return
    const next = [...pages]
    const [page] = next.splice(from, 1)
    next.splice(to, 0, page!)
    setPages(next)
    setStatus(`Page ${from + 1} moved to position ${to + 1}.`)
  }

  function duplicate(index: number) {
    const source = pages[index]!
    const copy: Artboard = {
      ...structuredClone(source),
      id: crypto.randomUUID(),
      name: `${source.name.slice(0, 113)} (copy)`,
      ...nextArtboardPosition(pages.map(artboardRect)),
    }
    setPages([...pages.slice(0, index + 1), copy, ...pages.slice(index + 1)])
    setStatus(`Page ${index + 1} duplicated as page ${index + 2}.`)
  }

  function remove(index: number) {
    if (pages.length < 2) return
    setPages(pages.filter((_, page) => page !== index))
    setStatus(`Page ${index + 1} removed.`)
  }

  function add() {
    const last = artboardRect(pages[pages.length - 1]!)
    const page = blankArtboard(
      { width: last.width, height: last.height },
      { ...nextArtboardPosition(pages.map(artboardRect)), name: `Page ${pages.length + 1}` }
    )
    setPages([...pages, page])
    setStatus(`Page ${pages.length + 1} added.`)
  }

  /** The index a page dropped at this pointer position would be inserted before. */
  function slot(event: DragEvent<HTMLElement>, index: number) {
    const box = event.currentTarget.getBoundingClientRect()
    return event.clientX < box.left + box.width / 2 ? index : index + 1
  }

  function over(event: DragEvent<HTMLElement>, index: number) {
    if (dragging === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setTarget(slot(event, index))
  }

  function drop(event: DragEvent<HTMLElement>, index: number) {
    event.preventDefault()
    if (dragging !== null) {
      const at = slot(event, index)
      move(dragging, at > dragging ? at - 1 : at)
    }
    setDragging(null)
    setTarget(null)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const document = canvasDocumentSchema.parse({ ...canvas.document, artboards: pages })
      await client.canvas.updateDocument.mutate({
        canvasId: canvas.id,
        baseRevision: canvas.revision,
        document,
      })
      toast.success(`Saved the pages of “${canvas.name}”.`)
      onSaved()
    } catch (cause) {
      const conflict = (cause as { data?: { code?: string } }).data?.code === 'CONFLICT'
      setError(
        conflict
          ? 'This canvas changed somewhere else. Close this, then open its pages again.'
          : cause instanceof Error
            ? cause.message
            : 'The pages could not be saved.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open && !saving ? onClose() : undefined)}>
      <DialogContent className="max-h-[88vh] gap-5 overflow-y-auto sm:max-w-4xl">
        <div className="space-y-1.5 pe-8">
          <DialogTitle className="font-normal">{canvas.name} · Pages</DialogTitle>
          <DialogDescription>
            Drag a page to reorder it, or use its arrows. Duplicate, delete or add pages, then save.
            Page order is the order the canvas prints and previews in.
          </DialogDescription>
        </div>
        <p aria-live="polite" className="sr-only">
          {status}
        </p>
        {/* Local: the site-wide GlobalDropZone would otherwise force a "copy"
            dropEffect on every dragover, which a moved page refuses. */}
        <ol
          data-local-dropzone=""
          aria-label="Pages"
          className="flex flex-wrap items-start gap-x-5 gap-y-6 rounded-xl bg-muted/50 p-5"
        >
          {pages.map((page, index) => {
            const { width, height } = artboardRect(page)
            return (
              <li
                className={cn('group/page relative min-w-0', dragging === index && 'opacity-40')}
                draggable
                key={page.id}
                onDragEnd={() => {
                  setDragging(null)
                  setTarget(null)
                }}
                onDragOver={(event) => over(event, index)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', page.id)
                  setDragging(index)
                }}
                onDrop={(event) => drop(event, index)}
                style={{ width: Math.min(TILE * (width / height), 236) }}
              >
                {/* Where the dragged page will land. */}
                {target === index ? (
                  <span className="absolute -left-3 top-0 h-[132px] w-0.5 rounded-full bg-foreground" />
                ) : null}
                {target === index + 1 && index === pages.length - 1 ? (
                  <span className="absolute -right-3 top-0 h-[132px] w-0.5 rounded-full bg-foreground" />
                ) : null}
                <div
                  className="relative overflow-hidden rounded-md bg-background shadow-[0_8px_20px_-12px_rgb(0_0_0/0.6)] ring-1 ring-border transition-shadow group-focus-within/page:ring-2 group-focus-within/page:ring-foreground group-hover/page:ring-foreground/40"
                  style={{ height: TILE }}
                >
                  <ProjectPreview
                    alt={`Page ${index + 1}: ${page.name}`}
                    className="studio-cover"
                    document={page.document}
                  />
                  <span
                    aria-hidden="true"
                    className="absolute left-1.5 top-1.5 grid size-6 cursor-grab place-items-center rounded-md bg-black/55 text-white opacity-0 backdrop-blur transition-opacity group-hover/page:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <DragIcon size={15} />
                  </span>
                  <span className="absolute right-1.5 top-1.5 flex gap-0.5 rounded-md bg-black/55 p-0.5 text-white opacity-0 backdrop-blur transition-opacity group-focus-within/page:opacity-100 group-hover/page:opacity-100 [@media(hover:none)]:opacity-100">
                    {[
                      {
                        label: `Move page ${index + 1} earlier`,
                        icon: ArrowBackIcon,
                        run: () => move(index, index - 1),
                        disabled: index === 0,
                      },
                      {
                        label: `Move page ${index + 1} later`,
                        icon: ArrowForwardIcon,
                        run: () => move(index, index + 1),
                        disabled: index === pages.length - 1,
                      },
                      {
                        label: `Duplicate page ${index + 1}`,
                        icon: CopyIcon,
                        run: () => duplicate(index),
                        disabled: pages.length >= 200,
                      },
                      {
                        label: `Delete page ${index + 1}`,
                        icon: DeleteIcon,
                        run: () => remove(index),
                        disabled: pages.length < 2,
                      },
                    ].map(({ label, icon: Icon, run, disabled }) => (
                      <button
                        aria-label={label}
                        className="touch-hitbox grid size-6 place-items-center rounded hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-35"
                        disabled={disabled || saving}
                        key={label}
                        onClick={run}
                        title={label.replace(` page ${index + 1}`, '')}
                        type="button"
                      >
                        <Icon size={14} />
                      </button>
                    ))}
                  </span>
                </div>
                <div className="mt-2 flex min-w-0 items-center gap-2 text-xs">
                  <span className="page-spread-number shrink-0">{index + 1}</span>
                  <span className="truncate text-muted-foreground">{page.name}</span>
                </div>
              </li>
            )
          })}
          <li className="w-24">
            <button
              className="grid w-full place-items-center gap-1 rounded-md bg-background/70 text-xs text-muted-foreground ring-1 ring-border transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
              disabled={saving || pages.length >= 200}
              onClick={add}
              style={{ height: TILE }}
              type="button"
            >
              <span className="grid justify-items-center gap-1">
                <AddIcon size={20} aria-hidden="true" />
                Add page
              </span>
            </button>
          </li>
        </ol>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {pages.length} page{pages.length === 1 ? '' : 's'}
            {changed ? ' · Unsaved changes' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="ghost">
              <Link href={`/canvas/${canvas.id}`}>Open in editor</Link>
            </Button>
            <Button disabled={saving} onClick={onClose} variant="outline">
              Cancel
            </Button>
            <Button disabled={!changed || saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save pages'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
