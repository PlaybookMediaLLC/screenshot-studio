'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { countIssues, runChecks } from '@/lib/store-screenshots/compliance'
import { evaluateSlide } from '@/lib/store-screenshots/engine/scene'
import { ExportCancelledError, runExportJob, zipOutputs, type ExportFailure, type ExportOutput, type ExportProgress } from '@/lib/store-screenshots/export/job'
import { planExport, slugify, type ExportSettings, type FolderLayout } from '@/lib/store-screenshots/export/plan'
import { localeName } from '@/lib/store-screenshots/locales'
import { getStoreTarget, sizeLabel, STORE_TARGETS, targetPixelSize, type ExportOrientation } from '@/lib/store-screenshots/targets'
import { cn } from '@/lib/utils'
import { downloadBlob, encodeCanvas, renderSceneToCanvas } from '../../render/capture'
import { useRenderServices } from '../../render/RenderProvider'
import { useStudioActions } from '../actions'
import { useEditor } from '../editor-store'
import { SlideThumbnail } from '../SlideThumbnail'
import type { DialogProps } from './BasicDialogs'

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

function defaults(slideIds: string[], sourceLocale: string): ExportSettings {
  return {
    targets: [
      { targetId: 'ios-iphone-6.9', sizeIndex: 0, orientation: 'portrait' },
      { targetId: 'ios-iphone-6.3', sizeIndex: 0, orientation: 'portrait' },
    ],
    format: 'png',
    quality: 0.92,
    locales: [sourceLocale],
    slideIds,
    folderLayout: 'store-locale-device',
    packaging: 'zip',
    prefix: '',
  }
}

/** The export dialog. */
export function ExportDialog({ open, onOpenChange }: DialogProps): React.JSX.Element {
  const actions = useStudioActions()
  const document = useEditor((state) => state.document)
  const { measurer, resolveAsset, whenAssetsReady } = useRenderServices()
  const allSlideIds = document.slides.map((slide) => slide.id)
  const [settings, setSettings] = React.useState<ExportSettings>(() => {
    const base = defaults(allSlideIds, document.localization.sourceLocale)
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY(document.id)) ?? 'null') as Partial<ExportSettings> | null
      if (!saved) return base
      const locales = (saved.locales ?? base.locales).filter((code) => code === document.localization.sourceLocale || document.localization.locales.includes(code))
      const slideIds = (saved.slideIds ?? base.slideIds).filter((id) => allSlideIds.includes(id))
      return { ...base, ...saved, locales: locales.length ? locales : base.locales, slideIds: slideIds.length ? slideIds : base.slideIds }
    } catch {
      return base
    }
  })
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
    [document, settings, measurer]
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
      const job = await runExportJob(
        files,
        async (file, signal) => {
          const target = getStoreTarget(file.targetId)!
          const scene = evaluateSlide(document, file.slideIndex, { size: targetPixelSize(target, file.sizeIndex, file.orientation), targetId: file.targetId, locale: file.locale, measurer })
          const canvas = await renderSceneToCanvas(scene, resolveAsset, { signal })
          return encodeCanvas(canvas, file.format, file.quality)
        },
        { signal: controller.signal, onProgress: setProgress }
      )
      if (job.outputs.length && settings.packaging === 'zip') {
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
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto" onEscapeKeyDown={(event) => running && event.preventDefault()}>
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
                      <label className="flex cursor-pointer items-start gap-2 text-xs">
                        <input type="checkbox" checked={Boolean(choice)} onChange={(event) => toggleTarget(target.id, event.target.checked)} className="mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{target.shortName}</span> <span className="text-muted-foreground">· {target.name}</span>
                          <span className="block text-[10px] text-muted-foreground">{target.devices}</span>
                        </span>
                        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px]', target.requirement === 'required' ? 'bg-foreground text-background' : 'bg-foreground/[0.07] text-muted-foreground')} title={target.requirementNote}>
                          {REQUIREMENT_BADGE[target.requirement]}
                        </span>
                      </label>
                      {choice ? (
                        <div className="mt-2 flex flex-wrap gap-2 pl-5">
                          <select aria-label={`${target.shortName} size`} value={choice.sizeIndex} onChange={(event) => setTargetOption(target.id, { sizeIndex: Number(event.target.value) })} className="h-7 rounded border border-foreground/10 bg-background px-1.5 text-[11px]">
                            {target.portraitSizes.map((size, index) => (
                              <option key={index} value={index}>
                                {sizeLabel(targetPixelSize(target, index, choice.orientation))}
                                {index === 0 ? ' (largest)' : ''}
                              </option>
                            ))}
                          </select>
                          {target.orientations.length > 1 ? (
                            <select aria-label={`${target.shortName} orientation`} value={choice.orientation} onChange={(event) => setTargetOption(target.id, { orientation: event.target.value as ExportOrientation })} className="h-7 rounded border border-foreground/10 bg-background px-1.5 text-[11px]">
                              {target.orientations.map((orientation) => (
                                <option key={orientation} value={orientation}>
                                  {orientation === 'portrait' ? 'Portrait' : 'Landscape'}
                                </option>
                              ))}
                            </select>
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
                  <label key={format} className="flex items-center gap-1.5 text-xs">
                    <input type="radio" name="export-format" checked={settings.format === format} onChange={() => update({ format })} />
                    {format === 'png' ? 'PNG (lossless)' : 'JPEG (smaller)'}
                  </label>
                ))}
              </div>
              {settings.format === 'jpeg' ? (
                <label className="block text-xs">
                  Quality {Math.round(settings.quality * 100)}%
                  <input type="range" min={60} max={100} value={Math.round(settings.quality * 100)} onChange={(event) => update({ quality: Number(event.target.value) / 100 })} className="mt-1 w-full" />
                </label>
              ) : null}
            </fieldset>
            <fieldset disabled={running} className="space-y-1.5">
              <legend className="mb-1 text-xs font-semibold">Languages</legend>
              {[document.localization.sourceLocale, ...document.localization.locales].map((code) => (
                <label key={code} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={settings.locales.includes(code)}
                    onChange={(event) => {
                      const locales = event.target.checked ? [...settings.locales, code] : settings.locales.filter((item) => item !== code)
                      if (locales.length) update({ locales })
                    }}
                  />
                  {localeName(code)}
                </label>
              ))}
            </fieldset>
            <fieldset disabled={running} className="space-y-1.5">
              <legend className="mb-1 flex w-full items-center justify-between text-xs font-semibold">
                <span>
                  Slides ({settings.slideIds.length} of {document.slides.length})
                </span>
                <button type="button" className="text-[11px] font-normal underline underline-offset-2" onClick={() => update({ slideIds: allSlideIds })}>
                  All
                </button>
              </legend>
              <div className="flex flex-wrap gap-1">
                {document.slides.map((slide, index) => {
                  const included = settings.slideIds.includes(slide.id)
                  return (
                    <button
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
                    </button>
                  )
                })}
              </div>
            </fieldset>
            <fieldset disabled={running} className="space-y-2">
              <legend className="mb-1 text-xs font-semibold">Files</legend>
              <div className="flex gap-3 text-xs">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="packaging" checked={settings.packaging === 'zip'} onChange={() => update({ packaging: 'zip' })} />
                  One ZIP
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="packaging" checked={settings.packaging === 'files'} onChange={() => update({ packaging: 'files' })} />
                  Separate images
                </label>
              </div>
              <label className="block text-xs">
                <span className="text-muted-foreground">Folders</span>
                <select value={settings.folderLayout} onChange={(event) => update({ folderLayout: event.target.value as FolderLayout })} className="mt-1 h-8 w-full rounded-md border border-foreground/10 bg-background px-2 text-xs">
                  <option value="store-locale-device">store / language / device</option>
                  <option value="locale-device">language / device</option>
                  <option value="flat">No folders</option>
                </select>
              </label>
              <label className="block text-xs">
                <span className="text-muted-foreground">File name prefix</span>
                <input value={settings.prefix} maxLength={40} onChange={(event) => update({ prefix: event.target.value })} placeholder="e.g. your app name" className="mt-1 h-8 w-full rounded-md border border-foreground/10 bg-background px-2 text-xs" />
              </label>
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
              <button type="button" className="underline underline-offset-2" onClick={() => actions.openDialog('checks')}>
                Review
              </button>
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
                    <button type="button" className="shrink-0 underline underline-offset-2" onClick={() => downloadBlob(output.blob, output.file.path.split('/').pop()!)}>
                      Download
                    </button>
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
