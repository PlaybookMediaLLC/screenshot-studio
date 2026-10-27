'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { countIssues, runChecks } from '@/lib/store-screenshots/compliance'
import { evaluateSlide } from '@/lib/store-screenshots/engine/scene'
import { ExportCancelledError, runExportJob, zipOutputs, type ExportFailure, type ExportOutput, type ExportProgress } from '@/lib/store-screenshots/export/job'
import { planExport, slugify, type ExportSettings, type FolderLayout } from '@/lib/store-screenshots/export/plan'
import { loadExportSettings } from '@/lib/store-screenshots/export/settings'
import { localeName } from '@/lib/store-screenshots/locales'
import { getStoreTarget, sizeLabel, STORE_TARGETS, targetPixelSize, type ExportOrientation } from '@/lib/store-screenshots/targets'
import { cn } from '@/lib/utils'
import { downloadBlob, encodeCanvas, renderSceneToCanvas } from '../../render/capture'
import { useRenderServices } from '../../render/RenderProvider'
import { useStudioActions } from '../actions'
import { useEditor } from '../editor-store'
import { SlideThumbnail } from '../SlideThumbnail'
import type { DialogProps } from './BasicDialogs'
import type { StoreDocument } from '@/lib/store-screenshots/document/schema'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'

/**
 * The export workflow: choose stores, sizes, format, languages, slides, and
 * packaging; preview each size; see what the checks found; then export
 * with real progress and cancellation. Nothing renders until Export is
 * pressed.
 */

const SETTINGS_KEY = (projectId: string) => `shots-store-export:${projectId}`

const REQUIREMENT_BADGE = {
  required: 'Required',
  conditional: 'Required in some cases',
  optional: 'Optional',
} as const

/** The export dialog. */
export function ExportDialog({ open, onOpenChange, strict = false, beforeExport, onExport }: DialogProps & {
  strict?: boolean
  beforeExport?: (document: StoreDocument) => Promise<void>
  onExport?: (outputs: ExportOutput[], document: StoreDocument, signal: AbortSignal) => Promise<void>
}): React.JSX.Element {
  const actions = useStudioActions()
  const document = useEditor((state) => state.document)
  const { measurer, resolveAsset, whenAssetsReady, fontsVersion } = useRenderServices()
  const allSlideIds = document.slides.map((slide) => slide.id)
  const [settings, setSettings] = React.useState<ExportSettings>(() => loadExportSettings(document))
  const [progress, setProgress] = React.useState<ExportProgress | null>(null)
  const [result, setResult] = React.useState<{ outputs: ExportOutput[]; failures: ExportFailure[] } | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const files = React.useMemo(() => planExport(document, settings), [document, settings])
  const issues = React.useMemo(
    () =>
      runChecks(
        document,
        { targets: settings.targets, format: settings.format, locales: settings.locales, slideIds: settings.slideIds },
        (index, target, sizeIndex, orientation, locale) =>
          evaluateSlide(document, index, { size: targetPixelSize(target, sizeIndex, orientation), targetId: target.id, locale, measurer })
      ),
    // Font readiness changes measured geometry without changing the measurer function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [document, settings, measurer, fontsVersion]
  )
  const counts = countIssues(issues)

  React.useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY(document.id), JSON.stringify(settings))
    } catch {
      // Storage full or disabled: settings simply are not remembered.
    }
  }, [document.id, settings])

  const update = (patch: Partial<ExportSettings>) => setSettings((current) => ({ ...current, ...patch }))
  const toggleTarget = (targetId: string, checked: boolean) => {
    const target = getStoreTarget(targetId)!
    update({
      targets: checked
        ? [...settings.targets, { targetId, sizeIndex: 0, orientation: target.orientations[0] }]
        : settings.targets.filter((item) => item.targetId !== targetId),
    })
  }
  const setTargetOption = (targetId: string, patch: { sizeIndex?: number; orientation?: ExportOrientation }) =>
    update({ targets: settings.targets.map((item) => (item.targetId === targetId ? { ...item, ...patch } : item)) })

  const start = async () => {
    const controller = new AbortController()
    abortRef.current = controller
    setResult(null)
    setProgress({ done: 0, total: files.length, current: files[0] ?? null })
    try {
      await whenAssetsReady(Object.keys(document.assets))
      await beforeExport?.(document)
      if (strict) {
        const checked = runChecks(document, { targets: settings.targets, format: settings.format, locales: settings.locales, slideIds: settings.slideIds },
          (index, target, sizeIndex, orientation, locale) => evaluateSlide(document, index, { size: targetPixelSize(target, sizeIndex, orientation), targetId: target.id, locale, measurer }))
        const blocked = checked.filter((issue) => ['overflow', 'clipped', 'empty-device', 'translation-missing', 'translation-outdated'].includes(issue.code))
        if (blocked.length) throw new Error(blocked.map((issue) => issue.message).join(' '))
      }
      const job = await runExportJob(
        files,
        async (file, signal) => {
          const target = getStoreTarget(file.targetId)!
          const scene = evaluateSlide(document, file.slideIndex, { size: targetPixelSize(target, file.sizeIndex, file.orientation), targetId: file.targetId, locale: file.locale, measurer })
          const canvas = await renderSceneToCanvas(scene, resolveAsset, { signal, strict })
          return encodeCanvas(canvas, file.format, file.quality)
        },
        { signal: controller.signal, onProgress: setProgress }
      )
      if (onExport && job.failures.length === 0) await onExport(job.outputs, document, controller.signal)
      else if (!onExport && job.outputs.length && settings.packaging === 'zip') {
        setProgress({ done: files.length, total: files.length, current: null })
        const zip = await zipOutputs(job.outputs, controller.signal)
        downloadBlob(zip, `${slugify(settings.prefix || document.name)}-store-screenshots.zip`)
      }
      setResult(job)
      if (job.failures.length === 0) toast.success(`Exported ${job.outputs.length} files`)
      else toast.warning(`Exported ${job.outputs.length} files; ${job.failures.length} failed`)
    } catch (cause) {
      if (cause instanceof ExportCancelledError) toast('Export cancelled. Nothing was downloaded.')
      else toast.error('Export failed', { description: cause instanceof Error ? cause.message : undefined })
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  const running = progress !== null
  const stores = [
    { id: 'app-store', name: 'App Store' },
    { id: 'google-play', name: 'Google Play' },
  ] as const

  return (
    <Dialog open={open} onOpenChange={(next) => (running ? undefined : onOpenChange(next))}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] max-h-[92vh] sm:max-w-5xl overflow-y-auto" onEscapeKeyDown={(event) => running && event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Export screenshots</DialogTitle>
          <DialogDescription>Images are rendered in your browser at exact store sizes, as PNG without transparency or JPEG.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            {stores.map((store) => (
              <fieldset key={store.id} disabled={running} className="space-y-1.5">
                <legend className="mb-1 text-xs font-semibold">{store.name}</legend>
                {STORE_TARGETS.filter((target) => target.store === store.id).map((target) => {
                  const choice = settings.targets.find((item) => item.targetId === target.id)
                  return (
                    <div key={target.id} className={cn('rounded-md border p-2', choice ? 'border-foreground/25 bg-foreground/[0.03]' : 'border-foreground/10')}>
                      <Label className="flex cursor-pointer items-start gap-2 text-xs">
                        <Checkbox  checked={Boolean(choice)} onCheckedChange={(checked) => toggleTarget(target.id, (checked === true))} className="mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{target.shortName}</span> <span className="text-muted-foreground">· {target.name}</span>
                          <span className="block text-[10px] text-muted-foreground">{target.devices}</span>
                        </span>
                        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px]', target.requirement === 'required' ? 'bg-foreground text-background' : 'bg-foreground/[0.07] text-muted-foreground')} title={target.requirementNote}>
                          {REQUIREMENT_BADGE[target.requirement]}
                        </span>
                      </Label>
                      {choice ? (
                        <div className="mt-2 flex flex-wrap gap-2 pl-5">
                          <Select
                            value={String(choice.sizeIndex)}
                            onValueChange={(nextValue) =>
                              setTargetOption(target.id, { sizeIndex: Number(nextValue) })
                            }
                          >
                            <SelectTrigger
                              aria-label={`${target.shortName} size`}
                              className="h-7 rounded border border-foreground/10 bg-background px-1.5 text-[11px]"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {target.portraitSizes.map((size, index) => (
                                <SelectItem key={index} value={String(index)}>
                                  {sizeLabel(targetPixelSize(target, index, choice.orientation))}
                                  {index === 0 ? ' (largest)' : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {target.orientations.length > 1 ? (
                            <Select
                              value={choice.orientation}
                              onValueChange={(nextValue) =>
                                setTargetOption(target.id, {
                                  orientation: nextValue as ExportOrientation,
                                })
                              }
                            >
                              <SelectTrigger
                                aria-label={`${target.shortName} orientation`}
                                className="h-7 rounded border border-foreground/10 bg-background px-1.5 text-[11px]"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {target.orientations.map((orientation) => (
                                  <SelectItem key={orientation} value={orientation}>
                                    {orientation === 'portrait' ? 'Portrait' : 'Landscape'}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : null}
                          <span className="self-center text-[10px] text-muted-foreground">Up to {target.maxCount} per language</span>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </fieldset>
            ))}
          </div>

          <div className="space-y-5">
            <fieldset disabled={running} className="space-y-2">
              <legend className="mb-1 text-xs font-semibold">Format</legend>
              <div className="flex gap-2">
                {(['png', 'jpeg'] as const).map((format) => (
                  <Label key={format} className="flex items-center gap-1.5 text-xs">
                    <Input type="radio" name="export-format" checked={settings.format === format} onChange={() => update({ format })} />
                    {format === 'png' ? 'PNG (lossless)' : 'JPEG (smaller)'}
                  </Label>
                ))}
              </div>
              {settings.format === 'jpeg' ? (
                <Label className="block text-xs">
                  Quality {Math.round(settings.quality * 100)}%
                  <Slider aria-label="Export quality"  min={60} max={100} value={[Math.round(settings.quality * 100)]} onValueChange={([nextValue]) => update({ quality: Number(nextValue) / 100 })} className="mt-1 w-full" />
                </Label>
              ) : null}
            </fieldset>
            <fieldset disabled={running} className="space-y-1.5">
              <legend className="mb-1 text-xs font-semibold">Languages</legend>
              {[document.localization.sourceLocale, ...document.localization.locales].map((code) => (
                <Label key={code} className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={settings.locales.includes(code)}
                    onCheckedChange={(checked) => {
                      const locales = (checked === true) ? [...settings.locales, code] : settings.locales.filter((item) => item !== code)
                      if (locales.length) update({ locales })
                    }}
                  />
                  {localeName(code)}
                </Label>
              ))}
            </fieldset>
            <fieldset disabled={running} className="space-y-1.5">
              <legend className="mb-1 flex w-full items-center justify-between text-xs font-semibold">
                <span>
                  Slides ({settings.slideIds.length} of {document.slides.length})
                </span>
                <Button variant="custom" size={null} type="button" className="text-[11px] font-normal underline underline-offset-2" onClick={() => update({ slideIds: allSlideIds })}>
                  All
                </Button>
              </legend>
              <div className="flex flex-wrap gap-1">
                {document.slides.map((slide, index) => {
                  const included = settings.slideIds.includes(slide.id)
                  return (
                    <Button variant="custom" size={null}
                      key={slide.id}
                      type="button"
                      aria-pressed={included}
                      title={slide.name}
                      onClick={() => {
                        const slideIds = included ? settings.slideIds.filter((id) => id !== slide.id) : allSlideIds.filter((id) => id === slide.id || settings.slideIds.includes(id))
                        if (slideIds.length) update({ slideIds })
                      }}
                      className={cn('h-7 min-w-7 rounded border px-1.5 text-[11px] tabular-nums', included ? 'border-foreground/40 bg-foreground/[0.1]' : 'border-foreground/10 text-muted-foreground line-through')}
                    >
                      {index + 1}
                    </Button>
                  )
                })}
              </div>
            </fieldset>
            <fieldset disabled={running} className="space-y-2">
              <legend className="mb-1 text-xs font-semibold">Files</legend>
              <div className="flex gap-3 text-xs">
                <Label className="flex items-center gap-1.5">
                  <Input type="radio" name="packaging" checked={settings.packaging === 'zip'} onChange={() => update({ packaging: 'zip' })} />
                  One ZIP
                </Label>
                <Label className="flex items-center gap-1.5">
                  <Input type="radio" name="packaging" checked={settings.packaging === 'files'} onChange={() => update({ packaging: 'files' })} />
                  Separate images
                </Label>
              </div>
              <Label className="block text-xs">
                <span className="text-muted-foreground">Folders</span>
                <Select
                  value={settings.folderLayout}
                  onValueChange={(nextValue) => update({ folderLayout: nextValue as FolderLayout })}
                >
                  <SelectTrigger className="mt-1 h-8 w-full rounded-md border border-foreground/10 bg-background px-2 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="store-locale-device">store / language / device</SelectItem>
                    <SelectItem value="locale-device">language / device</SelectItem>
                    <SelectItem value="flat">No folders</SelectItem>
                  </SelectContent>
                </Select>
              </Label>
              <Label className="block text-xs">
                <span className="text-muted-foreground">File name prefix</span>
                <Input value={settings.prefix} maxLength={40} onChange={(event) => update({ prefix: event.target.value })} placeholder="e.g. your app name" className="mt-1 h-8 w-full rounded-md border border-foreground/10 bg-background px-2 text-xs" />
              </Label>
              <p className="break-all text-[10px] text-muted-foreground">Example: {files[0]?.path ?? '—'}</p>
            </fieldset>
          </div>
        </div>

        {settings.targets.length ? (
          <section aria-labelledby="export-preview" className="space-y-2">
            <h3 id="export-preview" className="text-xs font-semibold">
              Preview at each size
            </h3>
            <div className="flex gap-4 overflow-x-auto pb-1">
              {settings.targets.map((choice) => {
                const target = getStoreTarget(choice.targetId)!
                const size = targetPixelSize(target, choice.sizeIndex, choice.orientation)
                return (
                  <figure key={choice.targetId} className="shrink-0 space-y-1">
                    <div className="flex gap-1.5">
                      {document.slides
                        .map((slide, index) => ({ slide, index }))
                        .filter(({ slide }) => settings.slideIds.includes(slide.id))
                        .slice(0, 3)
                        .map(({ slide, index }) => (
                          <SlideThumbnail key={slide.id} document={document} index={index} size={size} targetId={target.id} locale={settings.locales[0]} height={150} className="rounded ring-1 ring-foreground/10" />
                        ))}
                    </div>
                    <figcaption className="text-[10px] text-muted-foreground">
                      {target.shortName} · {sizeLabel(size)}
                    </figcaption>
                  </figure>
                )
              })}
            </div>
          </section>
        ) : null}

        <section aria-live="polite" className="space-y-2 rounded-md border border-foreground/10 bg-foreground/[0.02] p-3 text-xs">
          <p>
            <span className="font-semibold">{files.length} files</span> · {settings.targets.length} sizes × {settings.locales.length} languages × {settings.slideIds.length} slides
          </p>
          {counts.requirements + counts.recommendations > 0 ? (
            <p>
              {counts.requirements ? <span className="font-medium text-destructive">{counts.requirements} store requirement issues</span> : null}
              {counts.requirements && counts.recommendations ? ' · ' : ''}
              {counts.recommendations ? <span className="text-amber-700 dark:text-amber-300">{counts.recommendations} design suggestions</span> : null}{' '}
              <Button variant="custom" size={null} type="button" className="underline underline-offset-2" onClick={() => actions.openDialog('checks')}>
                Review
              </Button>
            </p>
          ) : (
            <p className="text-muted-foreground">No problems found. Store review can still reject screenshots for content reasons.</p>
          )}
          {issues
            .filter((issue) => issue.severity === 'requirement')
            .slice(0, 3)
            .map((issue) => (
              <p key={issue.id} className="text-destructive">
                {issue.message}
              </p>
            ))}
        </section>

        {progress ? (
          <div className="space-y-1.5" role="status">
            <div className="flex justify-between text-xs">
              <span className="truncate">{progress.current ? `Rendering ${progress.current.path}` : 'Packaging…'}</span>
              <span className="tabular-nums">
                {progress.done} / {progress.total}
              </span>
            </div>
            <progress className="h-1.5 w-full" max={progress.total} value={progress.done} aria-label="Export progress" />
          </div>
        ) : null}

        {result ? (
          <div className="space-y-2 text-xs">
            {result.failures.length ? (
              <div className="rounded-md border border-destructive/30 p-2">
                <p className="font-medium text-destructive">{result.failures.length} files could not be exported</p>
                <ul className="mt-1 list-disc pl-4">
                  {result.failures.slice(0, 6).map((failure) => (
                    <li key={failure.file.path}>
                      {failure.file.path}: {failure.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {settings.packaging === 'files' && result.outputs.length ? (
              <ul className="max-h-40 space-y-1 overflow-y-auto" aria-label="Exported files">
                {result.outputs.map((output) => (
                  <li key={output.file.path} className="flex items-center justify-between gap-2">
                    <span className="truncate">{output.file.path}</span>
                    <Button variant="custom" size={null} type="button" className="shrink-0 underline underline-offset-2" onClick={() => downloadBlob(output.blob, output.file.path.split('/').pop()!)}>
                      Download
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          {running ? (
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>
              Cancel export
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button disabled={files.length === 0} onClick={() => void start()}>
                Export {files.length} {files.length === 1 ? 'file' : 'files'}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
