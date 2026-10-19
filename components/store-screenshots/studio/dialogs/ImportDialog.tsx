'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MAX_PROJECT_SLIDES } from '@/lib/store-screenshots/commands/apply'
import { DEVICE_MODELS, getDeviceModel } from '@/lib/store-screenshots/devices'
import { createStandardSlide } from '@/lib/store-screenshots/document/factory'
import { MAX_IMAGE_BYTES, sniffRasterFormat } from '@/lib/store-screenshots/media/image'
import { ingestImageFiles } from '@/lib/store-screenshots/persistence/ingest'
import { cn } from '@/lib/utils'
import { useEditor, useEditorApi } from '../editor-store'
import type { DialogProps } from './BasicDialogs'
import { FigmaImport } from './FigmaImport'

/**
 * Bulk import: choose or drop many screenshots, review and reorder them,
 * then create one slide per image. Files are validated by content before
 * import; failures are listed and the rest still import.
 */

type Item = { id: string; file: File; url: string; problem: string | null }

const SIMULATOR = /^Simulator Screen ?[Ss]hot - (.+?) - (\d{4}-\d{2}-\d{2}) at ([\d.]+)/

/** A readable slide name for an imported file (simulator captures included). */
export function slideNameForFile(name: string): string {
  const simulator = SIMULATOR.exec(name)
  if (simulator) return `${simulator[1]} ${simulator[3]}`.slice(0, 80)
  return name.replace(/\.[^/.]+$/, '').slice(0, 80) || 'Screenshot'
}

/** The catalog device whose screen best matches an image. */
export function modelForAspect(aspect: number, fallback: string): string {
  const portrait = aspect > 1 ? 1 / aspect : aspect
  const match = DEVICE_MODELS.filter((model) => model.family === 'phone' || model.family === 'tablet')
    .map((model) => ({ model, distance: Math.abs(model.screenAspect - portrait) }))
    .sort((a, b) => a.distance - b.distance)[0]
  if (!match || match.distance > 0.03) return fallback
  return getDeviceModel(fallback).family === match.model.family ? fallback : match.model.id
}

async function check(file: File): Promise<string | null> {
  if (file.size > MAX_IMAGE_BYTES) return 'Larger than 25 MB'
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  return sniffRasterFormat(head) ? null : 'Not a PNG, JPEG, or WebP image'
}

/** The bulk import dialog. */
export function ImportDialog({ open, onOpenChange, initialFiles }: DialogProps & { initialFiles: File[] }): React.JSX.Element {
  const api = useEditorApi()
  const document = useEditor((state) => state.document)
  const [items, setItems] = React.useState<Item[]>([])
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)
  const [replaceSamples, setReplaceSamples] = React.useState(true)
  const [dragOver, setDragOver] = React.useState(false)
  const abortRef = React.useRef<AbortController | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const consumedFilesRef = React.useRef<File[] | null>(null)
  const onlySamples = document.slides.every((slide) => slide.layers.every((layer) => layer.type !== 'device' || !layer.assetId || layer.assetId.startsWith('public:')))
  const replacing = onlySamples && replaceSamples
  const room = MAX_PROJECT_SLIDES - (replacing ? 0 : document.slides.length)

  const addFiles = React.useCallback(async (files: File[]) => {
    const next = await Promise.all(
      files.map(async (file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file), problem: await check(file) }))
    )
    setItems((current) => [...current, ...next])
  }, [])

  React.useEffect(() => {
    if (!open || !initialFiles.length || consumedFilesRef.current === initialFiles) return
    consumedFilesRef.current = initialFiles
    void addFiles(initialFiles)
  }, [open, initialFiles, addFiles])

  React.useEffect(() => {
    if (open) return
    setItems((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.url))
      return []
    })
    setProgress(null)
  }, [open])

  const valid = items.filter((item) => !item.problem)
  const move = (index: number, delta: number) =>
    setItems((current) => {
      const next = [...current]
      const target = index + delta
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  const runImport = async () => {
    const files = valid.slice(0, room).map((item) => item.file)
    const controller = new AbortController()
    abortRef.current = controller
    setProgress({ done: 0, total: files.length })
    const report = await ingestImageFiles(files, (done, total) => setProgress({ done, total }), controller.signal)
    abortRef.current = null
    if (report.assets.length === 0) {
      setProgress(null)
      toast.error('No screenshots were imported', { description: report.failures[0]?.reason })
      return
    }
    const frame = document.theme.deviceFrame
    const frameFor = (aspect: number) => {
      const modelId = modelForAspect(aspect, frame.modelId)
      return modelId === frame.modelId ? frame : { ...frame, modelId, finishId: getDeviceModel(modelId).finishes[0].id }
    }
    const slides = report.assets.map((asset) =>
      createStandardSlide(
        slideNameForFile(asset.name),
        asset.id,
        'Show what makes your app special',
        'Explain the benefit in one clear sentence.',
        frameFor(asset.width / asset.height)
      )
    )
    const state = api.getState()
    const commands = [{ type: 'slides.add' as const, slides, assets: report.assets }]
    const removing = replacing ? state.document.slides.map((slide) => slide.id) : []
    state.dispatchMany(removing.length ? [...commands, { type: 'slides.delete' as const, slideIds: removing }] : commands, `Import ${slides.length} screenshots`)
    state.activateSlide(slides[0].id)
    setProgress(null)
    if (report.failures.length) {
      toast.warning(`${slides.length} imported, ${report.failures.length} skipped`, { description: report.failures.map((failure) => failure.reason).join(' ') })
    } else {
      toast.success(`${slides.length} slides created`)
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (progress ? undefined : onOpenChange(next))}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] max-h-[88vh] sm:max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import screenshots</DialogTitle>
          <DialogDescription>Each image becomes a slide, in the order below. PNG, JPEG, or WebP up to 25 MB.</DialogDescription>
        </DialogHeader>
        <div
          role="button"
          tabIndex={0}
          aria-label="Choose screenshots or drop them here"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragOver(false)
            void addFiles(Array.from(event.dataTransfer.files))
          }}
          className={cn('flex h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm', dragOver ? 'border-foreground/50 bg-foreground/[0.05]' : 'border-foreground/15 hover:bg-foreground/[0.03]')}
        >
          <span className="font-medium">Drop screenshots here or click to choose</span>
          <span className="text-xs text-muted-foreground">iOS Simulator captures (⌘S in Simulator, or `xcrun simctl io booted screenshot`) import directly.</span>
        </div>
        <input ref={inputRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => {
          void addFiles(Array.from(event.target.files ?? []))
          event.currentTarget.value = ''
        }} />
        <FigmaImport onFiles={(files) => void addFiles(files)} />
        {items.length ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {valid.length} ready{items.length > valid.length ? `, ${items.length - valid.length} can't be imported` : ''}
                {valid.length > room ? ` · only the first ${room} fit in this project` : ''}
              </span>
              <button type="button" className="underline underline-offset-2" onClick={() => setItems((current) => [...current].sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true })))}>
                Sort by name
              </button>
            </div>
            <ol aria-label="Screenshots to import" className="max-h-80 space-y-1 overflow-y-auto">
              {items.map((item, index) => (
                <li key={item.id} className={cn('flex items-center gap-2 rounded-md border p-1.5', item.problem ? 'border-destructive/30 bg-destructive/[0.04]' : 'border-foreground/10')}>
                  <span className="w-5 text-center text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
                  <img src={item.url} alt="" className="h-12 w-7 rounded object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{item.file.name}</span>
                    <span className={cn('block text-[10px]', item.problem ? 'text-destructive' : 'text-muted-foreground')}>{item.problem ?? `${(item.file.size / 1024 / 1024).toFixed(1)} MB`}</span>
                  </span>
                  <button type="button" aria-label={`Move ${item.file.name} up`} disabled={index === 0} onClick={() => move(index, -1)} className="flex size-7 items-center justify-center rounded hover:bg-foreground/[0.06] disabled:opacity-30">
                    ↑
                  </button>
                  <button type="button" aria-label={`Move ${item.file.name} down`} disabled={index === items.length - 1} onClick={() => move(index, 1)} className="flex size-7 items-center justify-center rounded hover:bg-foreground/[0.06] disabled:opacity-30">
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => {
                      URL.revokeObjectURL(item.url)
                      setItems((current) => current.filter((candidate) => candidate.id !== item.id))
                    }}
                    className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {onlySamples ? (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={replaceSamples} onChange={(event) => setReplaceSamples(event.target.checked)} />
            Replace the sample slides
          </label>
        ) : null}
        {progress ? (
          <div className="space-y-1.5" role="status" aria-live="polite">
            <div className="flex justify-between text-xs">
              <span>
                Importing {progress.done} of {progress.total}
              </span>
              <button type="button" className="underline underline-offset-2" onClick={() => abortRef.current?.abort()}>
                Stop
              </button>
            </div>
            <progress className="h-1.5 w-full" max={progress.total} value={progress.done} aria-label="Import progress" />
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={Boolean(progress)} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={valid.length === 0 || room <= 0 || Boolean(progress)} onClick={() => void runImport()}>
            Create {Math.min(valid.length, room)} {Math.min(valid.length, room) === 1 ? 'slide' : 'slides'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
