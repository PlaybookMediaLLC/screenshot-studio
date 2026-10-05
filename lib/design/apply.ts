'use client'

import { createDeviceScreen, createMockup } from '@/lib/device-mockups/layouts'
import type { DeviceLayoutId } from '@/types/mockup'
import { useEditorStore, useImageStore } from '@/lib/store'
import type { DesignDocument } from './document'
import { resolveEditorTemplate } from './templates'

/**
 * Load a DesignDocument into the editor stores.
 *
 * Shared by the editor (`?design=<id>`) and the headless render page, so a
 * design renders the same wherever it is opened. Loading happens in two
 * phases because the editor stores some geometry in on-screen pixels:
 *
 * 1. `applyDesignDocument` sets everything that is size-independent, starting
 *    from the template exactly as the editor applies it.
 * 2. `applyDesignLayout` converts the document's normalized positions and
 *    sizes once the canvas has measured itself.
 *
 * Neither phase is recorded in undo history; the loaded design is the new
 * starting point.
 */

/** Maps a document source ref (`asset:<id>` or `/path`) to a loadable URL. */
export type ResolveDesignSource = (ref: string) => string

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

function withoutHistory(apply: () => void) {
  const history = useImageStore.temporal.getState()
  history.pause()
  try {
    apply()
  } finally {
    history.clear()
    history.resume()
  }
}

export function applyDesignDocument(document: DesignDocument, resolve: ResolveDesignSource) {
  withoutHistory(() => {
    const image = useImageStore.getState()
    const editor = useEditorStore.getState()
    const mainSrc = document.image.src ? resolve(document.image.src) : null

    image.clearImage()
    editor.setScreenshot({ offsetX: 0, offsetY: 0, rotation: 0 })
    if (mainSrc) image.setUploadedImageUrl(mainSrc, 'design')

    const template = resolveEditorTemplate(document.template)
    if (template) {
      image.applyVisualPreset(template.preset, { clearAnimation: true, scene: template.scene })
    }

    if (document.canvas?.aspectRatio) {
      useImageStore.setState({ selectedAspectRatio: document.canvas.aspectRatio })
    }
    if (document.canvas?.padding !== undefined) {
      editor.setCanvas({ padding: document.canvas.padding })
    }

    if (document.background) {
      const { blur, noise, opacity, radius, type, value } = document.background
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
    if (document.pattern) editor.setPattern(document.pattern)

    const { frame, shadow } = document.image
    useImageStore.setState({
      ...(document.image.scale !== undefined ? { imageScale: document.image.scale } : {}),
      ...(document.image.opacity !== undefined ? { imageOpacity: document.image.opacity } : {}),
      ...(document.image.radius !== undefined ? { borderRadius: document.image.radius } : {}),
      ...(document.image.browserHeaderSize !== undefined
        ? { browserHeaderSize: document.image.browserHeaderSize }
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
        imageStylePreset:
          frameStylePreset[frame.type as keyof typeof frameStylePreset] ?? 'default',
      })
    }
    if (document.image.perspective) {
      useImageStore.setState((state) => ({
        perspective3D: { ...state.perspective3D, ...document.image.perspective },
      }))
    }
    if (document.image.filters) {
      useImageStore.setState((state) => ({
        imageFilters: { ...state.imageFilters, ...document.image.filters },
      }))
    }
    if (document.image.rotation !== undefined) {
      editor.setScreenshot({ rotation: document.image.rotation })
    }

    if (document.devices?.mockups.length) {
      useImageStore.setState({
        activeDeviceLayoutId: null,
        deviceLayoutSnapshot: null,
        mockups: document.devices.mockups.map((device, index) => {
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
    } else if (document.devices?.layoutId) {
      useImageStore.getState().applyDeviceLayout(document.devices.layoutId as DeviceLayoutId)
    }
    if (document.mode) useImageStore.setState({ editorMode: document.mode })

    if (document.animation) {
      useImageStore.getState().applyAnimationPreset(document.animation.presetId)
      useImageStore.setState((state) => ({
        showTimeline: false,
        timeline: { ...state.timeline, isPlaying: false, playhead: 0 },
      }))
    }
  })
}

/** Phase 2: place size-dependent layers once the canvas knows its on-screen size. */
export function applyDesignLayout(
  document: DesignDocument,
  resolve: ResolveDesignSource,
  canvas: { canvasH: number; canvasW: number }
) {
  const { canvasH, canvasW } = canvas
  withoutHistory(() => {
    if (document.image.offset) {
      useEditorStore.getState().setScreenshot({
        offsetX: document.image.offset.x * canvasW,
        offsetY: document.image.offset.y * canvasH,
      })
    }
    useImageStore.setState((state) => ({
      annotations: document.annotations.map((shape, index) => ({
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
      blurRegions: document.redactions.map((region, index) => ({
        blurAmount: region.amount,
        id: newId('blur', index),
        isVisible: true,
        position: { x: region.position.x * canvasW, y: region.position.y * canvasH },
        size: { height: region.size.height * canvasH, width: region.size.width * canvasW },
        style: region.style,
      })),
      // Template shadow overlays stay; document overlays are added on top.
      imageOverlays: [
        ...state.imageOverlays,
        ...document.overlays.map((overlay, index) => ({
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
      textOverlays: document.texts.map((text, index) => ({
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
    }))
  })
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
): Promise<{ canvasH: number; canvasW: number }> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const matches = (dims: { canvasH: number; canvasW: number } | null) =>
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
