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
import { ANIMATION_PRESETS, frameAt, slideDurations, totalDuration, type AnimationFormat } from '@/lib/store-screenshots/animation/timeline'
import { deviceMotionSchema, textRevealSchema, transitionSchema } from '@/lib/store-screenshots/document/schema'
import { slugify } from '@/lib/store-screenshots/export/plan'
import { localeName } from '@/lib/store-screenshots/locales'
import { terminateFFmpeg } from '@/lib/export/ffmpeg-encoder'
import { drawFrame, encodeAnimation, prepareSlideLayers, type SlideLayers } from '../../render/animation'
import { downloadBlob } from '../../render/capture'
import { useRenderServices } from '../../render/RenderProvider'
import { NumberField, SelectField, SliderField } from '../controls'
import { useEditor, useEditorApi } from '../editor-store'
import type { DialogProps } from './BasicDialogs'
import { Slider } from '@/components/ui/slider'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'

const PREVIEW_HEIGHT = 520
/** Seconds into a slide where its entrance has finished, so a still preview shows the whole slide. */
const SETTLED_AT = 1.2

const TRANSITION_LABELS = { none: 'Cut', fade: 'Fade', slide: 'Slide', zoom: 'Zoom' } as const
const REVEAL_LABELS = { none: 'None', fade: 'Fade in', rise: 'Rise in' } as const
const MOTION_LABELS = { none: 'None', float: 'Gentle float', rise: 'Rise in' } as const

/**
 * Animated preview and GIF/MP4 export. Timing lives in the project, so the
 * preview, every export, and a reopened project use the same settings.
 */
export function AnimationDialog({ open, onOpenChange }: DialogProps): React.JSX.Element {
  const api = useEditorApi()
  const document = useEditor((state) => state.document)
  const editingLocale = useEditor((state) => state.locale)
  const { measurer, resolveAsset, whenAssetsReady } = useRenderServices()
  const settings = document.animation
  const [presetId, setPresetId] = React.useState<(typeof ANIMATION_PRESETS)[number]['id']>('story')
  const [locale, setLocale] = React.useState(editingLocale)
  const [format, setFormat] = React.useState<AnimationFormat>('mp4')
  const [previewLayers, setPreviewLayers] = React.useState<SlideLayers[] | null>(null)
  const [time, setTime] = React.useState(SETTLED_AT)
  const [playing, setPlaying] = React.useState(false)
  const [job, setJob] = React.useState<{ phase: string; fraction: number } | null>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const preset = ANIMATION_PRESETS.find((item) => item.id === presetId)!
  const slideIds = document.slides.map((slide) => slide.id)
  const durations = slideDurations(document, slideIds)
  const total = totalDuration(durations)
  const previewSize = { width: Math.round((preset.width / preset.height) * PREVIEW_HEIGHT), height: PREVIEW_HEIGHT }
  const patch = (animation: Partial<typeof settings>, key: string) => api.getState().dispatch({ type: 'project.patch', patch: { animation } }, { key: `animation:${key}` })

  // Re-render preview layers when the design, size, or language changes.
  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setPreviewLayers(null)
    void (async () => {
      try {
        await whenAssetsReady(Object.keys(document.assets))
        const layers = await prepareSlideLayers(document, document.slides.map((_slide, index) => index), previewSize, locale, { measurer, resolveAsset }, { signal: controller.signal })
        if (!controller.signal.aborted) setPreviewLayers(layers)
      } catch (cause) {
        if (!controller.signal.aborted) toast.error('Preview could not be rendered', { description: cause instanceof Error ? cause.message : undefined })
      }
    })()
    return () => controller.abort()
    // Timing changes do not need new layers; only content, size, and language do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, document.slides, document.theme, document.assets, document.panoramas, locale, presetId, measurer, resolveAsset])

  React.useEffect(() => {
    const context = canvasRef.current?.getContext('2d')
    if (!context || !previewLayers) return
    drawFrame(context, frameAt(settings, durations, time), previewLayers, previewSize.width, previewSize.height)
  })

  React.useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      setTime((current) => {
        const next = current + (now - last) / 1000
        return next >= total ? 0 : next
      })
      last = now
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, total])

  const runExport = async () => {
    const controller = new AbortController()
    abortRef.current = controller
    setPlaying(false)
    try {
      setJob({ phase: 'Rendering slides', fraction: 0 })
      await whenAssetsReady(Object.keys(document.assets))
      const layers = await prepareSlideLayers(document, document.slides.map((_slide, index) => index), preset, locale, { measurer, resolveAsset }, {
        signal: controller.signal,
        onProgress: (done, count) => setJob({ phase: 'Rendering slides', fraction: (done / count) * 0.3 }),
      })
      setJob({ phase: format === 'gif' ? 'Encoding GIF' : 'Encoding MP4', fraction: 0.3 })
      const blob = await encodeAnimation(format, layers, settings, durations, preset, {
        signal: controller.signal,
        onProgress: (fraction) => setJob({ phase: format === 'gif' ? 'Encoding GIF' : 'Encoding MP4', fraction: 0.3 + fraction * 0.7 }),
      })
      downloadBlob(blob, `${slugify(document.name)}-${preset.id}-${locale}.${format === 'gif' ? 'gif' : 'mp4'}`)
      toast.success(`${format.toUpperCase()} exported`, { description: `${total.toFixed(1)} s · ${preset.width} × ${preset.height} · ${(blob.size / 1024 / 1024).toFixed(1)} MB` })
    } catch (cause) {
      if (controller.signal.aborted) toast('Animation export cancelled')
      else toast.error('Animation export failed', { description: cause instanceof Error ? cause.message : undefined })
    } finally {
      abortRef.current = null
      setJob(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (job ? undefined : onOpenChange(next))}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] max-h-[94vh] sm:max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Animated preview</DialogTitle>
          <DialogDescription>Turn the set into a short video or GIF for social posts and listings. This is a slideshow of your designs, not captured app footage, so it is not guaranteed to qualify as an App Store app preview.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-[auto_1fr]">
          <div className="space-y-2">
            <div className="flex items-center justify-center overflow-hidden rounded-lg bg-black" style={{ width: previewSize.width, height: previewSize.height }}>
              <canvas ref={canvasRef} width={previewSize.width} height={previewSize.height} aria-label="Animation preview" role="img" />
              {!previewLayers ? <span className="absolute text-xs text-white/70">Rendering preview…</span> : null}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={!previewLayers} onClick={() => setPlaying((value) => !value)} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? 'Pause' : 'Play'}
              </Button>
              <Slider  aria-label="Timeline position" min={0} max={total} step={0.01} value={[time]} onValueChange={([nextValue]) => setTime(Number(nextValue))} className="flex-1" />
              <span className="w-20 text-right text-[11px] tabular-nums text-muted-foreground">
                {time.toFixed(1)} / {total.toFixed(1)} s
              </span>
            </div>
            <div className="flex h-6 overflow-hidden rounded" aria-label="Slide timeline">
              {document.slides.map((slide, index) => (
                <Button variant="custom" size={null}
                  key={slide.id}
                  type="button"
                  title={`${slide.name}: ${durations[index]} s`}
                  onClick={() => setTime(durations.slice(0, index).reduce((sum, value) => sum + value, 0) + Math.min(SETTLED_AT, durations[index] / 2))}
                  className="border-r border-background bg-foreground/15 text-[9px] last:border-r-0 hover:bg-foreground/25"
                  style={{ width: `${(durations[index] / total) * 100}%` }}
                >
                  {index + 1}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <SelectField label="Transition" value={settings.transition} options={transitionSchema.options.map((value) => ({ value, label: TRANSITION_LABELS[value] }))} onChange={(transition) => patch({ transition }, 'transition')} />
              <NumberField label="Transition length" unit="s" value={settings.transitionDuration} min={0} max={3} step={0.1} precision={1} onChange={(transitionDuration) => patch({ transitionDuration }, 'transition-length')} />
              <SelectField label="Text" value={settings.textReveal} options={textRevealSchema.options.map((value) => ({ value, label: REVEAL_LABELS[value] }))} onChange={(textReveal) => patch({ textReveal }, 'text')} />
              <SelectField label="Devices" value={settings.deviceMotion} options={deviceMotionSchema.options.map((value) => ({ value, label: MOTION_LABELS[value] }))} onChange={(deviceMotion) => patch({ deviceMotion }, 'device')} />
            </div>
            <SliderField label="Slow zoom" unit="%" value={Math.round(settings.kenBurns * 100)} min={0} max={40} onChange={(value) => patch({ kenBurns: value / 100 }, 'zoom')} />
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Default slide length" unit="s" value={settings.slideDuration} min={0.5} max={15} step={0.5} precision={1} onChange={(slideDuration) => patch({ slideDuration }, 'length')} />
              <NumberField label="Frame rate" unit="fps" value={settings.fps} min={5} max={60} onChange={(fps) => patch({ fps }, 'fps')} hint="GIFs are capped at 15 fps." />
            </div>
            <Accordion type="single" collapsible>
              <AccordionItem value="details" className="text-xs">
                <AccordionTrigger className="cursor-pointer">Length per slide</AccordionTrigger>
                <AccordionContent className="p-0">
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {document.slides.map((slide, index) => (
                      <NumberField
                        key={slide.id}
                        label={`${index + 1}. ${slide.name}`}
                        unit="s"
                        value={durations[index]}
                        min={0.5}
                        max={15}
                        step={0.5}
                        precision={1}
                        onChange={(value) =>
                          patch(
                            { slideDurations: { ...settings.slideDurations, [slide.id]: value } },
                            `length-${slide.id}`
                          )
                        }
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
            <div className="grid grid-cols-2 gap-3">
              <SelectField label="Size" value={presetId} options={ANIMATION_PRESETS.map((item) => ({ value: item.id, label: item.name }))} onChange={setPresetId} />
              <SelectField label="Language" value={locale} options={[document.localization.sourceLocale, ...document.localization.locales].map((code) => ({ value: code, label: localeName(code) }))} onChange={setLocale} />
            </div>
            <SelectField<AnimationFormat> label="Format" value={format} options={[{ value: 'mp4', label: 'MP4 video (H.264)' }, { value: 'gif', label: 'Animated GIF' }]} onChange={setFormat} />
            {job ? (
              <div className="space-y-1.5" role="status">
                <div className="flex justify-between text-xs">
                  <span>{job.phase}…</span>
                  <span className="tabular-nums">{Math.round(job.fraction * 100)}%</span>
                </div>
                <progress className="h-1.5 w-full" max={1} value={job.fraction} aria-label="Animation export progress" />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    abortRef.current?.abort()
                    if (job.phase.startsWith('Encoding') && format === 'gif') terminateFFmpeg()
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button onClick={() => void runExport()}>
                Export {format.toUpperCase()} ({total.toFixed(1)} s)
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
