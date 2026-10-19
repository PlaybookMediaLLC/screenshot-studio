'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ChoiceField } from '@/components/editor/inspector/fields'
import {
  redactImage,
  type RedactionMethod,
  redactionMethodSchema,
  replaceScreenshotEverywhere,
} from '@/lib/redaction/apply'
import type { Finding, FindingKind, ImageBox } from '@/lib/redaction/patterns'
import { type ScanProgress, scanImage } from '@/lib/redaction/scan'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'

/** Suggestions at or above this confidence start approved; the rest wait for a decision. */
const AUTO_APPROVE = 0.75

const KIND_LABELS: Record<FindingKind | 'manual', string> = {
  card: 'Card number',
  credential: 'Credential',
  email: 'Email',
  face: 'Face',
  manual: 'Added by you',
  name: 'Likely name',
  phone: 'Phone number',
}
const KIND_COLORS: Record<FindingKind | 'manual', string> = {
  card: '#f97316',
  credential: '#ef4444',
  email: '#3b82f6',
  face: '#a855f7',
  manual: '#22c55e',
  name: '#eab308',
  phone: '#14b8a6',
}

type ReviewItem = {
  approved: boolean
  box: ImageBox
  confidence: number | null
  id: string
  kind: FindingKind | 'manual'
  label: string
}

const clamp = (value: number) => Math.min(1, Math.max(0, value))

function toItems(findings: readonly Finding[]): ReviewItem[] {
  return findings.map((finding) => ({
    approved: finding.confidence >= AUTO_APPROVE,
    box: finding.box,
    confidence: finding.confidence,
    id: finding.id,
    kind: finding.kind,
    label: finding.label,
  }))
}

type Drag = { id: string; mode: 'move' | 'resize'; pointerX: number; pointerY: number; start: ImageBox }

/** The screenshot with every region drawn over it; regions move, resize, and can be drawn. */
function RegionCanvas({
  imageUrl,
  items,
  onAdd,
  onChange,
  onToggle,
  selectedId,
  setSelectedId,
}: {
  imageUrl: string
  items: ReviewItem[]
  onAdd: (box: ImageBox) => void
  onChange: (id: string, box: ImageBox) => void
  onToggle: (id: string) => void
  selectedId: string | null
  setSelectedId: (id: string | null) => void
}) {
  const frame = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<Drag | null>(null)
  const [drawing, setDrawing] = React.useState<{ box: ImageBox; startX: number; startY: number } | null>(null)

  const fraction = (event: React.PointerEvent) => {
    const rect = frame.current!.getBoundingClientRect()
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const rect = frame.current?.getBoundingClientRect()
    if (!rect) return
    if (drag.current) {
      const dx = (event.clientX - drag.current.pointerX) / rect.width
      const dy = (event.clientY - drag.current.pointerY) / rect.height
      const { start } = drag.current
      onChange(
        drag.current.id,
        drag.current.mode === 'move'
          ? { ...start, x: clamp(start.x + dx), y: clamp(start.y + dy) }
          : { ...start, height: Math.max(0.005, start.height + dy), width: Math.max(0.005, start.width + dx) }
      )
    } else if (drawing) {
      const point = fraction(event)
      setDrawing({
        ...drawing,
        box: {
          height: Math.abs(point.y - drawing.startY),
          width: Math.abs(point.x - drawing.startX),
          x: Math.min(point.x, drawing.startX),
          y: Math.min(point.y, drawing.startY),
        },
      })
    }
  }

  const endPointer = () => {
    drag.current = null
    if (drawing && drawing.box.width > 0.005 && drawing.box.height > 0.005) onAdd(drawing.box)
    setDrawing(null)
  }

  return (
    <div className="relative flex min-h-0 items-center justify-center overflow-auto rounded-md bg-[repeating-conic-gradient(rgb(127_127_127/0.12)_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-3">
      <div
        className="relative inline-block cursor-crosshair select-none"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget && !(event.target as HTMLElement).dataset.image) return
          event.currentTarget.setPointerCapture(event.pointerId)
          const point = fraction(event)
          setSelectedId(null)
          setDrawing({ box: { height: 0, width: 0, ...point }, startX: point.x, startY: point.y })
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        ref={(node) => {
          frame.current = node
        }}
        title="Drag on the screenshot to add a redaction"
      >
        <img alt="Screenshot under review" className="block max-h-[60vh] max-w-full" data-image="true" draggable={false} src={imageUrl} />
        {items.map((item) => (
          <Button variant="custom" size={null}
            aria-label={`${KIND_LABELS[item.kind]}${item.approved ? ', will be redacted' : ', skipped'}`}
            aria-pressed={item.approved}
            className={cn('absolute rounded-[2px] outline-offset-1', selectedId === item.id && 'outline outline-2 outline-white')}
            key={item.id}
            onClick={(event) => {
              event.stopPropagation()
              if (selectedId === item.id) onToggle(item.id)
              setSelectedId(item.id)
            }}
            onPointerDown={(event) => {
              event.stopPropagation()
              event.currentTarget.setPointerCapture(event.pointerId)
              drag.current = { id: item.id, mode: 'move', pointerX: event.clientX, pointerY: event.clientY, start: item.box }
            }}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            style={{
              background: item.approved ? `${KIND_COLORS[item.kind]}55` : 'transparent',
              border: `2px ${item.approved ? 'solid' : 'dashed'} ${KIND_COLORS[item.kind]}`,
              height: `${item.box.height * 100}%`,
              left: `${item.box.x * 100}%`,
              top: `${item.box.y * 100}%`,
              width: `${item.box.width * 100}%`,
            }}
            type="button"
          >
            {selectedId === item.id ? (
              <span
                aria-hidden
                className="absolute -right-1.5 -bottom-1.5 size-3 cursor-nwse-resize rounded-full border-2 border-white bg-blue-500"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  drag.current = { id: item.id, mode: 'resize', pointerX: event.clientX, pointerY: event.clientY, start: item.box }
                }}
                onPointerMove={onPointerMove}
                onPointerUp={endPointer}
              />
            ) : null}
          </Button>
        ))}
        {drawing ? (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-green-500 bg-green-500/20"
            style={{
              height: `${drawing.box.height * 100}%`,
              left: `${drawing.box.x * 100}%`,
              top: `${drawing.box.y * 100}%`,
              width: `${drawing.box.width * 100}%`,
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

/**
 * Review and apply redactions on the screenshot. Scanning runs on this
 * device; every suggestion can be approved, rejected, moved, resized, or
 * removed, and regions can be drawn by hand. Applying destroys the pixels
 * in the screenshot itself.
 */
export function RedactionReviewDialog({
  imageUrl,
  onOpenChange,
  open,
  scan,
}: {
  imageUrl: string | null
  onOpenChange: (open: boolean) => void
  open: boolean
  /** Start with a scan; otherwise the user draws regions by hand. */
  scan: boolean
}) {
  const [items, setItems] = React.useState<ReviewItem[]>([])
  const [progress, setProgress] = React.useState<ScanProgress | null>(null)
  const [warnings, setWarnings] = React.useState<string[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [method, setMethod] = React.useState<RedactionMethod>(redactionMethodSchema.enum.cover)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [applying, setApplying] = React.useState(false)
  const scanRun = React.useRef<AbortController | null>(null)

  const runScan = React.useCallback(async () => {
    if (!imageUrl) return
    scanRun.current?.abort()
    const controller = new AbortController()
    scanRun.current = controller
    setError(null)
    setWarnings([])
    try {
      const result = await scanImage(imageUrl, setProgress, controller.signal)
      if (controller.signal.aborted) return
      setItems((current) => [...current.filter((item) => item.kind === 'manual'), ...toItems(result.findings)])
      setWarnings(result.warnings)
    } catch (scanError) {
      if (!controller.signal.aborted) setError(scanError instanceof Error ? scanError.message : 'The scan failed.')
    } finally {
      if (scanRun.current === controller) setProgress(null)
    }
  }, [imageUrl])

  React.useEffect(() => {
    if (!open) {
      scanRun.current?.abort()
      setItems([])
      setSelectedId(null)
      setProgress(null)
      return
    }
    if (scan) void runScan()
  }, [open, runScan, scan])

  const addRegion = React.useCallback((box: ImageBox) => {
    const id = `manual-${crypto.randomUUID()}`
    setItems((current) => [...current, { approved: true, box, confidence: null, id, kind: 'manual', label: 'Region' }])
    setSelectedId(id)
  }, [])

  const approved = items.filter((item) => item.approved)

  const apply = async () => {
    if (!imageUrl || approved.length === 0) return
    setApplying(true)
    try {
      const blob = await redactImage(imageUrl, approved.map((item) => ({ box: item.box, method })))
      replaceScreenshotEverywhere(imageUrl, URL.createObjectURL(blob))
      toast.success(`${approved.length} redaction${approved.length === 1 ? '' : 's'} applied`, {
        description: 'The covered pixels are gone from the screenshot and every export. Undo to edit them.',
      })
      onOpenChange(false)
    } catch (applyError) {
      toast.error('Could not apply the redactions', {
        description: applyError instanceof Error ? applyError.message : undefined,
      })
    } finally {
      setApplying(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="grid max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Redact sensitive information</DialogTitle>
          <DialogDescription>
            Detection runs on this device and the screenshot is not uploaded. It finds many emails, keys, names, and
            faces, but not all of them: check the whole screenshot and draw over anything it missed.
          </DialogDescription>
        </DialogHeader>
          <div className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
            {imageUrl ? (
              <RegionCanvas
                imageUrl={imageUrl}
                items={items}
                onAdd={addRegion}
                onChange={(id, box) => setItems((current) => current.map((item) => (item.id === id ? { ...item, box } : item)))}
                onToggle={(id) =>
                  setItems((current) => current.map((item) => (item.id === id ? { ...item, approved: !item.approved } : item)))
                }
                selectedId={selectedId}
                setSelectedId={setSelectedId}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Add a screenshot first.</p>
            )}
            <div className="flex min-h-0 flex-col gap-3">
              {progress ? (
                <div aria-live="polite" className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">{progress.message}…</p>
                  <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
                    <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress.progress * 100)}%` }} />
                  </div>
                </div>
              ) : (
                <Button className="h-8 text-xs" disabled={!imageUrl} onClick={() => void runScan()} size="sm" variant="outline">
                  {items.some((item) => item.kind !== 'manual') ? 'Scan again' : 'Scan for sensitive information'}
                </Button>
              )}
              {error ? <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p> : null}
              {warnings.map((warning) => (
                <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400" key={warning}>
                  {warning} Draw regions by hand for anything it would have found.
                </p>
              ))}
              <ChoiceField
                label="Method"
                onChange={setMethod}
                options={[
                  { label: 'Cover', value: redactionMethodSchema.enum.cover },
                  { label: 'Pixelate', value: redactionMethodSchema.enum.pixelate },
                  { label: 'Blur', value: redactionMethodSchema.enum.blur },
                ]}
                value={method}
              />
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">
                  {items.length === 0 ? 'No regions yet' : `${approved.length} of ${items.length} will be redacted`}
                </p>
                {items.length > 0 ? (
                  <Button variant="custom" size={null}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => setItems((current) => current.map((item) => ({ ...item, approved: true })))}
                    type="button"
                  >
                    Approve all
                  </Button>
                ) : null}
              </div>
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label="Redaction suggestions">
                {items.map((item) => (
                  <li
                    className={cn(
                      'flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs',
                      selectedId === item.id ? 'border-foreground/30 bg-foreground/[0.05]' : 'border-foreground/10'
                    )}
                    key={item.id}
                  >
                    <Checkbox
                      aria-label={`Redact ${KIND_LABELS[item.kind]}`}
                      checked={item.approved}
                      onCheckedChange={() => setItems((current) => current.map((other) => (other.id === item.id ? { ...other, approved: !other.approved } : other)))}
                    />
                    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: KIND_COLORS[item.kind] }} />
                    <Button variant="custom" size={null} className="min-w-0 flex-1 truncate text-left" onClick={() => setSelectedId(item.id)} type="button">
                      {item.kind === 'manual' ? KIND_LABELS.manual : item.label}
                    </Button>
                    {item.confidence !== null ? (
                      <span className="tabular-nums text-muted-foreground" title="Detector confidence">
                        {Math.round(item.confidence * 100)}%
                      </span>
                    ) : null}
                    <Button variant="custom" size={null}
                      aria-label="Remove region"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setItems((current) => current.filter((other) => other.id !== item.id))}
                      type="button"
                    >
                      ×
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Click a region to select it, click again to skip or include it. Drag to move; drag the corner to resize;
                drag on the screenshot to add one.
              </p>
            </div>
          </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="ghost">
            Cancel
          </Button>
          <Button disabled={approved.length === 0 || applying} onClick={() => void apply()}>
            {applying ? 'Applying…' : `Apply ${approved.length} redaction${approved.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
