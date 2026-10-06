'use client'

import { getAspectRatioPreset } from '@/lib/aspect-ratio-utils'
import { createDeviceScreen, createMockup } from '@/lib/device-mockups/layouts'
import type { DeviceLayoutId } from '@/types/mockup'
import { useEditorStore, useImageStore } from '@/lib/store'
import type { DesignChanges, DesignDocument } from './document'
import { resolveEditorTemplate } from './templates'

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

/**
 * Collapse every history entry recorded since `start` into one, so a whole
 * AI edit (or a chosen variation) undoes with a single ⌘Z. Call
 * `beginHistoryStep` before the writes and `endHistoryStep` after; this works
 * across awaits as long as the user does not edit in between.
 */
export function beginHistoryStep(): number {
  return useImageStore.temporal.getState().pastStates.length
}

export function endHistoryStep(start: number) {
  useImageStore.temporal.setState((history) =>
    history.pastStates.length > start + 1
      ? { pastStates: history.pastStates.slice(0, start + 1) }
      : history
  )
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
function writeSections(changes: DesignChanges, resolve: ResolveDesignSource) {
  const image = useImageStore.getState()
  const editor = useEditorStore.getState()

  if (changes.image?.src) image.setUploadedImageUrl(resolve(changes.image.src), 'design')
  const mainSrc = useImageStore.getState().uploadedImageUrl

  const template = resolveEditorTemplate(changes.template)
  if (template) {
    image.applyVisualPreset(template.preset, { clearAnimation: true, scene: template.scene })
  }

  if (changes.canvas?.aspectRatio) {
    useImageStore.setState({ selectedAspectRatio: changes.canvas.aspectRatio })
  }
  if (changes.canvas?.padding !== undefined) editor.setCanvas({ padding: changes.canvas.padding })

  if (changes.background) {
    const { blur, noise, opacity, radius, type, value } = changes.background
    useImageStore.setState({
      backgroundBlur: blur,
      backgroundConfig: {
        opacity,
        type,
        value: value.startsWith('asset:') ? resolve(value) : value,
      },
      backgroundNoise: noise,
      ...(radius !== undefined ? { backgroundBorderRadius: radius } : {}),
    })
  }
  if (changes.pattern) editor.setPattern(changes.pattern)

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
  if (imageChanges.rotation !== undefined) editor.setScreenshot({ rotation: imageChanges.rotation })

  if (changes.devices?.mockups.length) {
    useImageStore.setState({
      activeDeviceLayoutId: null,
      deviceLayoutSnapshot: null,
      mockups: changes.devices.mockups.map((device, index) => {
        const screenSrc = device.screen.src ? resolve(device.screen.src) : mainSrc
        return {
          ...createMockup(device.definitionId, createDeviceScreen(screenSrc, 'design'), index),
          opacity: device.opacity,
          position: { ...device.position },
          rotation: device.rotation,
          screen: { ...createDeviceScreen(screenSrc, 'design'), fit: device.screen.fit },
          size: device.size,
        }
      }),
    })
  } else if (changes.devices?.layoutId) {
    useImageStore.getState().applyDeviceLayout(changes.devices.layoutId as DeviceLayoutId)
  } else if (changes.devices && changes.devices.mockups.length === 0) {
    useImageStore.setState({ activeDeviceLayoutId: null, deviceLayoutSnapshot: null, mockups: [] })
  }
  if (changes.mode) useImageStore.setState({ editorMode: changes.mode })

  if (changes.animation) {
    useImageStore.getState().applyAnimationPreset(changes.animation.presetId)
    useImageStore.setState((state) => ({
      showTimeline: false,
      timeline: { ...state.timeline, isPlaying: false, playhead: 0 },
    }))
  }
}

/** Phase 2 for whichever layout sections `changes` carries. Lists replace the current list. */
function writeLayout(changes: DesignChanges, resolve: ResolveDesignSource, canvas: CanvasSize) {
  const { canvasH, canvasW } = canvas
  if (changes.image?.offset) {
    useEditorStore.getState().setScreenshot({
      offsetX: changes.image.offset.x * canvasW,
      offsetY: changes.image.offset.y * canvasH,
    })
  }
  useImageStore.setState((state) => ({
    ...(changes.annotations
      ? {
          annotations: changes.annotations.map((shape, index) => ({
            fillColor: shape.fillColor,
            id: newId('annotation', index),
            isVisible: true,
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
            id: newId('blur', index),
            isVisible: true,
            position: { x: region.position.x * canvasW, y: region.position.y * canvasH },
            size: { height: region.size.height * canvasH, width: region.size.width * canvasW },
            style: region.style,
          })),
        }
      : {}),
    ...(changes.overlays
      ? {
          // Template light/shadow overlays belong to the template, not the list.
          imageOverlays: [
            ...state.imageOverlays.filter((overlay) =>
              overlay.id.startsWith(TEMPLATE_SHADOW_PREFIX)
            ),
            ...changes.overlays.map((overlay, index) => ({
              flipX: overlay.flipX,
              flipY: overlay.flipY,
              id: newId('overlay', index),
              isCustom: overlay.src.startsWith('asset:'),
              isVisible: true,
              layer: overlay.layer,
              opacity: overlay.opacity,
              position: { x: overlay.position.x * canvasW, y: overlay.position.y * canvasH },
              rotation: overlay.rotation,
              size: overlay.size * canvasW,
              src: overlay.src.startsWith('asset:') ? resolve(overlay.src) : overlay.src,
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
            id: newId('text', index),
            isVisible: true,
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
    useEditorStore.getState().setScreenshot({ offsetX: 0, offsetY: 0, rotation: 0 })
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
export async function applyDesignChanges(changes: DesignChanges, resolve: ResolveDesignSource) {
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
