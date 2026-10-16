'use client'

import { motionFromTimeline } from '@/lib/animation/motion-schema'
import { getAspectRatioPreset } from '@/lib/aspect-ratio-utils'
import { createDeviceScreen, createMockup } from '@/lib/device-mockups/layouts'
import type { DeviceLayoutId } from '@/types/mockup'
import { beginHistoryStep, endHistoryStep, useImageStore } from '@/lib/store'
import {
  type DesignChanges,
  type DesignDocument,
  type DesignSections,
  patchDesignDocument,
  pickChangedSections,
} from './document'
import { exportDesignDocument } from './export'
import { resolveEditorTemplate } from './templates'
import { resetPlayback } from '@/lib/store/playback'
import { applyCompositionLayout } from '@/lib/frames/commands'
import { compositionLayoutSchema } from '@/lib/frames/layouts'
import { DEFAULT_FRAME_CHROME } from '@/lib/frames/schema'

/**
 * Write designs and design changes into the editor stores.
 *
 * Shared by every way a design reaches the editor: opening a stored design
 * (`?design=<id>`), the headless render page, choosing an AI variation, and
 * the in-editor copilot applying an edit. All of them go through the editor's
 * own store actions, so an AI edit is indistinguishable from a manual one.
 *
 * Geometry is applied in two phases because the editor keeps some layers in
 * on-screen pixels:
 *
 * 1. size-independent sections (template, background, frame, 3D, devices, …);
 * 2. layout sections (text, overlays, annotations, redactions, offsets),
 *    converted from normalized units once the canvas has measured itself.
 */

/** Maps a document source ref (`asset:<id>` or `/path`) to a loadable URL. */
export type ResolveDesignSource = (ref: string) => string

export type CanvasSize = { canvasH: number; canvasW: number }

/** How a write shows up in undo history. */
export type DesignHistoryMode = 'clear' | 'step'

const TEMPLATE_SHADOW_PREFIX = 'template-shadow-'

const frameStylePreset = {
  'border-dark': 'border-dark',
  'border-light': 'border-light',
  'glass-dark': 'glass-dark',
  'glass-light': 'glass-light',
  'outline-light': 'outline',
} as const

function newId(prefix: string, index: number): string {
  return `${prefix}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`
}

function inHistory(mode: DesignHistoryMode, write: () => void) {
  const history = useImageStore.temporal.getState()
  if (mode === 'clear') {
    history.pause()
    try {
      write()
    } finally {
      history.clear()
      history.resume()
    }
    return
  }
  const start = beginHistoryStep()
  write()
  endHistoryStep(start)
}

/** Phase 1 for whichever sections `changes` carries; untouched sections stay as they are. */
function writeSections(changes: DesignSections, resolve: ResolveDesignSource) {
  const image = useImageStore.getState()

  if (changes.image?.src) {
    image.setUploadedImageUrl(resolve(changes.image.src), changes.image.name ?? 'design')
  }
  const mainSrc = useImageStore.getState().uploadedImageUrl

  const template = resolveEditorTemplate(changes.template)
  if (template) {
    image.applyVisualPreset(template.preset, { clearAnimation: true, scene: template.scene })
  }

  if (changes.canvas?.aspectRatio === 'custom' && changes.canvas.size) {
    useImageStore.setState({ customDimensions: { ...changes.canvas.size }, selectedAspectRatio: 'custom' })
  } else if (changes.canvas?.aspectRatio && changes.canvas.aspectRatio !== 'custom') {
    useImageStore.setState({ selectedAspectRatio: changes.canvas.aspectRatio })
  }
  if (changes.canvas?.padding !== undefined) image.setCanvasPadding(changes.canvas.padding)

  if (changes.background) {
    const { blur, noise, opacity, radius, type, value } = changes.background
    useImageStore.setState({
      backgroundBlur: blur,
      backgroundConfig: {
        opacity,
        type,
        value: type === 'image' ? resolve(value) : value,
      },
      backgroundNoise: noise,
      ...(radius !== undefined ? { backgroundBorderRadius: radius } : {}),
    })
  }
  if (changes.pattern) image.setPattern(changes.pattern)
  if (changes.brand) image.setBrand(changes.brand)
  if (changes.copy) image.setCopy(changes.copy)

  const imageChanges = changes.image ?? {}
  const { frame, shadow } = imageChanges
  useImageStore.setState({
    ...(imageChanges.scale !== undefined ? { imageScale: imageChanges.scale } : {}),
    ...(imageChanges.opacity !== undefined ? { imageOpacity: imageChanges.opacity } : {}),
    ...(imageChanges.radius !== undefined ? { borderRadius: imageChanges.radius } : {}),
    ...(imageChanges.browserHeaderSize !== undefined
      ? { browserHeaderSize: imageChanges.browserHeaderSize }
      : {}),
  })
  if (imageChanges.chrome) useImageStore.setState({ frameChrome: structuredClone(imageChanges.chrome) })
  if (shadow?.preset) useImageStore.getState().setShadowPreset(shadow.preset)
  if (shadow?.custom) useImageStore.setState({ imageShadow: shadow.custom })
  if (frame) {
    useImageStore.setState({
      browserUrl: frame.title ?? '',
      imageBorder: {
        color: frame.color,
        enabled: frame.type !== 'none',
        opacity: frame.opacity,
        padding: frame.padding,
        title: frame.title ?? '',
        type: frame.type,
        width: frame.width,
      },
      imageStylePreset: frameStylePreset[frame.type as keyof typeof frameStylePreset] ?? 'default',
    })
  }
  if (imageChanges.perspective) {
    useImageStore.setState((state) => ({
      perspective3D: { ...state.perspective3D, ...imageChanges.perspective },
    }))
  }
  if (imageChanges.filters) {
    useImageStore.setState((state) => ({
      imageFilters: { ...state.imageFilters, ...imageChanges.filters },
    }))
  }
  if (imageChanges.rotation !== undefined) {
    image.setImagePlacement({ rotation: imageChanges.rotation })
  }

  if (changes.devices?.mockups.length) {
    useImageStore.setState({
      activeDeviceLayoutId: (changes.devices.layoutId as DeviceLayoutId | undefined) ?? null,
      deviceLayoutSnapshot: null,
      mockups: changes.devices.mockups.map((device, index) => {
        const custom = Boolean(device.screen.src)
        // A code screen draws its code; any other screen without a source shows the main image.
        const screenSrc = device.screen.code ? null : device.screen.src ? resolve(device.screen.src) : mainSrc
        const screen = createDeviceScreen(screenSrc, device.screen.name ?? 'design', custom)
        return {
          ...createMockup(device.definitionId, screen, index),
          ...(device.id ? { id: device.id } : {}),
          ...(device.frame ? { frame: structuredClone(device.frame) } : {}),
          ...(device.color ? { color: device.color } : {}),
          ...(device.orientation ? { orientation: device.orientation } : {}),
          isVisible: device.visible ?? true,
          opacity: device.opacity,
          position: { ...device.position },
          rotation: device.rotation,
          screen: {
            ...screen,
            fit: device.screen.fit,
            offset: device.screen.offset ? { ...device.screen.offset } : screen.offset,
            scale: device.screen.scale ?? screen.scale,
            ...(device.screen.aspect !== undefined ? { aspect: device.screen.aspect } : {}),
            ...(device.screen.code ? { code: structuredClone(device.screen.code) } : {}),
          },
          size: device.size,
        }
      }),
    })
  } else if (changes.devices?.layoutId) {
    const composition = compositionLayoutSchema.safeParse(changes.devices.layoutId)
    if (composition.success) applyCompositionLayout(composition.data)
    else useImageStore.getState().applyDeviceLayout(changes.devices.layoutId as DeviceLayoutId)
  } else if (changes.devices && changes.devices.mockups.length === 0) {
    useImageStore.setState({ activeDeviceLayoutId: null, deviceLayoutSnapshot: null, mockups: [] })
  }
  if (changes.mode) useImageStore.setState({ editorMode: changes.mode })
  // Elements are stored in canvas fractions, so they load as they are.
  if (changes.elements) useImageStore.setState({ elements: structuredClone(changes.elements) })

  if (changes.timeline) {
    const { clips, duration, isLooping, tracks } = changes.timeline
    const motion = motionFromTimeline(changes.timeline)
    useImageStore.setState((state) => ({
      animationClips: clips.map((clip) => ({ ...clip })),
      motion: { ...motion, audio: motion.audio.map((clip) => ({ ...clip, src: resolve(clip.src) })) },
      timeline: { ...state.timeline, duration, isLooping, tracks: structuredClone(tracks) },
    }))
    resetPlayback()
  } else if (changes.animation) {
    useImageStore.getState().applyAnimationPreset(changes.animation.presetId)
    useImageStore.setState({ showTimeline: false })
  }

  if (changes.slides) {
    const { activeId, animation, defaultDuration, enabled, items } = changes.slides
    const slides = items.map((slide) => ({ ...slide, src: resolve(slide.src) }))
    const active = slides.find((slide) => slide.id === activeId) ?? slides[0]
    useImageStore.setState({
      activeSlideId: active?.id ?? null,
      slides,
      slideshow: { animation, defaultDuration, enabled },
    })
  }
}

/** Phase 2 for whichever layout sections `changes` carries. Lists replace the current list. */
function writeLayout(changes: DesignSections, resolve: ResolveDesignSource, canvas: CanvasSize) {
  const { canvasH, canvasW } = canvas
  if (changes.image?.offset) {
    useImageStore.getState().setImagePlacement({
      offsetX: changes.image.offset.x * canvasW,
      offsetY: changes.image.offset.y * canvasH,
    })
  }
  useImageStore.setState((state) => ({
    ...(changes.annotations
      ? {
          annotations: changes.annotations.map((shape, index) => ({
            ...(shape.control
              ? { cx: shape.control.x * canvasW, cy: shape.control.y * canvasH }
              : {}),
            fillColor: shape.fillColor,
            id: shape.id ?? newId('annotation', index),
            isVisible: shape.visible ?? true,
            opacity: shape.opacity,
            strokeColor: shape.strokeColor,
            strokeWidth: shape.strokeWidth,
            type: shape.type,
            x1: shape.start.x * canvasW,
            x2: shape.end.x * canvasW,
            y1: shape.start.y * canvasH,
            y2: shape.end.y * canvasH,
          })),
        }
      : {}),
    ...(changes.redactions
      ? {
          blurRegions: changes.redactions.map((region, index) => ({
            blurAmount: region.amount,
            id: region.id ?? newId('blur', index),
            isVisible: region.visible ?? true,
            position: { x: region.position.x * canvasW, y: region.position.y * canvasH },
            size: { height: region.size.height * canvasH, width: region.size.width * canvasW },
            style: region.style,
          })),
        }
      : {}),
    ...(changes.overlays
      ? {
          // Template light/shadow overlays belong to the template, not the list,
          // unless the document carries them itself (a lossless export does).
          imageOverlays: [
            ...(changes.overlays.some((overlay) => overlay.role === 'template-light')
              ? []
              : state.imageOverlays.filter((overlay) => overlay.id.startsWith(TEMPLATE_SHADOW_PREFIX))),
            ...changes.overlays.map((overlay, index) => ({
              ...(overlay.blur !== undefined ? { blur: overlay.blur } : {}),
              ...(overlay.radius !== undefined ? { radius: overlay.radius } : {}),
              ...(overlay.shadow ? { shadow: overlay.shadow } : {}),
              ...(overlay.tilt ? { tilt: { ...overlay.tilt } } : {}),
              flipX: overlay.flipX,
              flipY: overlay.flipY,
              id:
                overlay.role === 'template-light'
                  ? newId(TEMPLATE_SHADOW_PREFIX.slice(0, -1), index)
                  : (overlay.id ?? newId('overlay', index)),
              isCustom: overlay.src.startsWith('asset:') || /^(blob|data):/.test(overlay.src),
              isVisible: overlay.visible ?? true,
              layer: overlay.layer,
              opacity: overlay.opacity,
              position: { x: overlay.position.x * canvasW, y: overlay.position.y * canvasH },
              rotation: overlay.rotation,
              size: overlay.size * canvasW,
              src: resolve(overlay.src),
            })),
          ],
        }
      : {}),
    ...(changes.texts
      ? {
          textOverlays: changes.texts.map((text, index) => ({
            color: text.color,
            fontFamily: text.fontFamily,
            fontSize: Math.round(text.fontSize * canvasW),
            fontWeight: text.fontWeight,
            ...(text.align ? { align: text.align } : {}),
            ...(text.fill ? { fill: text.fill } : {}),
            ...(text.fit ? { fit: text.fit } : {}),
            ...(text.letterSpacing !== undefined ? { letterSpacing: text.letterSpacing } : {}),
            ...(text.lineHeight !== undefined ? { lineHeight: text.lineHeight } : {}),
            ...(text.maxWidth !== undefined ? { maxWidth: text.maxWidth } : {}),
            ...(text.role ? { role: text.role } : {}),
            id: text.id ?? newId('text', index),
            isVisible: text.visible ?? true,
            opacity: text.opacity,
            orientation: text.orientation,
            position: { ...text.position },
            text: text.text,
            textShadow: text.shadow ?? {
              blur: 0,
              color: 'rgba(0,0,0,0)',
              enabled: false,
              offsetX: 0,
              offsetY: 0,
            },
          })),
        }
      : {}),
  }))
}

/** Phase 1 of loading a whole document: reset the canvas, then apply every section. */
export function applyDesignDocument(
  document: DesignDocument,
  resolve: ResolveDesignSource,
  history: DesignHistoryMode = 'clear'
) {
  inHistory(history, () => {
    const mainSrc = document.image.src ? resolve(document.image.src) : null
    const keepImage = !mainSrc ? useImageStore.getState().uploadedImageUrl : null
    useImageStore.getState().clearImage()
    useImageStore.setState({ frameChrome: { ...DEFAULT_FRAME_CHROME } })
    if (keepImage) useImageStore.getState().setUploadedImageUrl(keepImage, 'design')
    writeSections(document, resolve)
  })
}

/** Phase 2 of loading a whole document, once the canvas has settled. */
export function applyDesignLayout(
  document: DesignDocument,
  resolve: ResolveDesignSource,
  canvas: CanvasSize,
  history: DesignHistoryMode = 'clear'
) {
  inHistory(history, () => writeLayout(document, resolve, canvas))
}

/**
 * Apply an edit to the live canvas without resetting it. Both phases are
 * grouped into one undo step; when the edit changes the aspect ratio, layout
 * waits for the canvas to settle at the new size first.
 */
export async function applyDesignChanges(rawChanges: DesignChanges, resolve: ResolveDesignSource) {
  // Merge into the current design first, so a partial change ("rotateY: 12")
  // keeps every field it did not name, and the result is validated as a whole.
  const merged = patchDesignDocument(exportDesignDocument(), rawChanges)
  const changes = pickChangedSections(merged, rawChanges)
  const start = beginHistoryStep()
  writeSections(changes, resolve)
  const changesLayout =
    changes.image?.offset ||
    changes.annotations ||
    changes.redactions ||
    changes.overlays ||
    changes.texts
  if (changesLayout) {
    const canvas = changes.canvas?.aspectRatio
      ? await waitForSettledCanvas(currentAspectRatio())
      : (useImageStore.getState().canvasDimensions ?? (await waitForSettledCanvas(null)))
    writeLayout(changes, resolve, canvas)
  }
  endHistoryStep(start)
}

function currentAspectRatio(): number | null {
  const preset = getAspectRatioPreset(useImageStore.getState().selectedAspectRatio)
  return preset ? preset.width / preset.height : null
}

/**
 * Resolve once the canvas has measured itself for the current aspect ratio
 * and held that size briefly. The stage measures in more than one pass (a
 * fallback viewport first), and placing pixel layers against an early pass
 * would misplace them once the canvas settles.
 */
export function waitForSettledCanvas(
  expectedRatio: number | null,
  settleMs = 250,
  timeoutMs = 10_000
): Promise<CanvasSize> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const matches = (dims: CanvasSize | null) =>
      Boolean(dims) &&
      (expectedRatio === null ||
        Math.abs(dims!.canvasW / dims!.canvasH - expectedRatio) / expectedRatio < 0.02)
    const finish = () => {
      unsubscribe()
      clearTimeout(deadline)
      const dims = useImageStore.getState().canvasDimensions
      resolve(dims ?? { canvasH: 1080, canvasW: 1920 })
    }
    const arm = () => {
      clearTimeout(timer)
      if (matches(useImageStore.getState().canvasDimensions)) timer = setTimeout(finish, settleMs)
    }
    const unsubscribe = useImageStore.subscribe((state, previous) => {
      if (state.canvasDimensions !== previous.canvasDimensions) arm()
    })
    const deadline = setTimeout(finish, timeoutMs)
    arm()
  })
}
