'use client'

import { getAspectRatioPreset } from '@/lib/aspect-ratio-utils'
import { exportElementAsCanvas } from '@/lib/export/export-service'
import { getCanvasContainer } from '@/components/canvas/ClientCanvas'
import { useEditorStore, useImageStore } from '@/lib/store'
import { useDeviceUIStore } from '@/lib/store/device-ui'
import { DESIGN_DOCUMENT_VERSION, type DesignDocument, designDocumentSchema } from './document'

/**
 * Read the live editor into a DesignDocument: the inverse of applyDesign*.
 *
 * Pixel layers are converted back to normalized units against the current
 * canvas. Each section is validated on its own and dropped if it is not
 * portable (a local upload as background, a CSS-variable color, a custom
 * sticker), so one exotic setting never blocks exporting the rest.
 *
 * The main image is not part of the document: `image.src` is set by the
 * caller (`asset:<id>` once uploaded) or left null for in-editor use, where
 * the copilot edits around the image already on the canvas.
 */

const shape = designDocumentSchema.shape
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const hex = /^#[0-9a-f]{3,8}$|^rgba?\([\d\s.,%]+\)$/i

function valid<T>(
  schema: { safeParse: (value: unknown) => { data?: T; success: boolean } },
  value: unknown
) {
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function validItems<T>(
  schema: { element: { safeParse: (value: unknown) => { data?: T; success: boolean } } },
  items: unknown[]
) {
  return items
    .map((item) => valid(schema.element, item))
    .filter((item): item is T => item !== undefined)
}

export function exportDesignDocument(): DesignDocument {
  const image = useImageStore.getState()
  const editor = useEditorStore.getState()
  const canvasW = image.canvasDimensions?.canvasW ?? 1920
  const canvasH = image.canvasDimensions?.canvasH ?? 1080

  const raw = {
    annotations: validItems(
      shape.annotations.unwrap(),
      image.annotations
        .filter((shape) => shape.isVisible && shape.type !== 'blur')
        .map((shape) => ({
          end: { x: clamp(shape.x2 / canvasW, 0, 1), y: clamp(shape.y2 / canvasH, 0, 1) },
          fillColor: shape.fillColor,
          opacity: shape.opacity,
          start: { x: clamp(shape.x1 / canvasW, 0, 1), y: clamp(shape.y1 / canvasH, 0, 1) },
          strokeColor: shape.strokeColor,
          strokeWidth: clamp(shape.strokeWidth, 1, 40),
          type: shape.type,
        }))
    ),
    background: valid(shape.background, {
      blur: image.backgroundBlur,
      noise: image.backgroundNoise,
      opacity: image.backgroundConfig.opacity ?? 1,
      radius: clamp(image.backgroundBorderRadius, 0, 100),
      type: image.backgroundConfig.type,
      value: image.backgroundConfig.value,
    }),
    canvas: valid(shape.canvas, {
      aspectRatio: image.selectedAspectRatio,
      padding: clamp(editor.canvas.padding, 0, 200),
    }),
    devices:
      image.mockups.length > 0
        ? valid(shape.devices, {
            mockups: image.mockups
              .filter((mockup) => mockup.isVisible)
              .map((mockup) => ({
                definitionId: mockup.definitionId,
                opacity: mockup.opacity,
                position: { x: clamp(mockup.position.x, 0, 1), y: clamp(mockup.position.y, 0, 1) },
                rotation: mockup.rotation,
                screen: { fit: mockup.screen.fit, src: null },
                size: clamp(mockup.size, 0.05, 1),
              })),
          })
        : undefined,
    image: {
      frame: valid(shape.image.shape.frame, {
        color: hex.test(image.imageBorder.color) ? image.imageBorder.color : '#ffffff',
        opacity: image.imageBorder.opacity ?? 1,
        padding: clamp(image.imageBorder.padding ?? 0, 0, 100),
        title: image.browserUrl || image.imageBorder.title || undefined,
        type: image.imageBorder.enabled ? image.imageBorder.type : 'none',
        width: clamp(image.imageBorder.width, 0, 40),
      }),
      filters: image.imageFilters,
      offset: {
        x: clamp(editor.screenshot.offsetX / canvasW, -0.5, 0.5),
        y: clamp(editor.screenshot.offsetY / canvasH, -0.5, 0.5),
      },
      opacity: image.imageOpacity,
      perspective: {
        perspective: clamp(image.perspective3D.perspective, 200, 5000),
        rotateX: clamp(image.perspective3D.rotateX, -60, 60),
        rotateY: clamp(image.perspective3D.rotateY, -60, 60),
        rotateZ: clamp(image.perspective3D.rotateZ, -180, 180),
        scale: clamp(image.perspective3D.scale, 0.3, 2),
        translateX: clamp(image.perspective3D.translateX, -30, 30),
        translateY: clamp(image.perspective3D.translateY, -30, 30),
      },
      radius: clamp(image.borderRadius, 0, 100),
      rotation: clamp(editor.screenshot.rotation, -180, 180),
      scale: clamp(image.imageScale, 10, 200),
      shadow: { preset: image.shadowPreset },
      src: null,
    },
    mode: image.editorMode,
    overlays: validItems(
      shape.overlays.unwrap(),
      image.imageOverlays
        .filter((overlay) => overlay.isVisible && !overlay.id.startsWith('template-shadow-'))
        .map((overlay) => ({
          flipX: overlay.flipX,
          flipY: overlay.flipY,
          layer: overlay.layer ?? 'front',
          opacity: overlay.opacity,
          position: {
            x: clamp(overlay.position.x / canvasW, 0, 1),
            y: clamp(overlay.position.y / canvasH, 0, 1),
          },
          rotation: overlay.rotation,
          size: clamp(overlay.size / canvasW, 0.01, 2),
          src: overlay.src,
        }))
    ),
    pattern: editor.pattern.enabled ? valid(shape.pattern, editor.pattern) : undefined,
    redactions: validItems(
      shape.redactions.unwrap(),
      image.blurRegions
        .filter((region) => region.isVisible)
        .map((region) => ({
          amount: clamp(region.blurAmount, 1, 60),
          position: {
            x: clamp(region.position.x / canvasW, 0, 1),
            y: clamp(region.position.y / canvasH, 0, 1),
          },
          size: {
            height: clamp(region.size.height / canvasH, 0, 1),
            width: clamp(region.size.width / canvasW, 0, 1),
          },
          style: region.style ?? 'blur',
        }))
    ),
    texts: validItems(
      shape.texts.unwrap(),
      image.textOverlays
        .filter((text) => text.isVisible)
        .map((text) => ({
          color: text.color,
          fontFamily: text.fontFamily,
          fontSize: clamp(text.fontSize / canvasW, 0.005, 0.3),
          fontWeight: text.fontWeight,
          opacity: text.opacity,
          orientation: text.orientation,
          position: { x: clamp(text.position.x, 0, 100), y: clamp(text.position.y, 0, 100) },
          shadow: text.textShadow,
          text: text.text,
        }))
    ),
    version: DESIGN_DOCUMENT_VERSION,
  }
  const parsed = designDocumentSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  // Last resort: anything still invalid in the image section is dropped field by field.
  const imageFields = Object.fromEntries(
    Object.entries(raw.image).filter(([key, value]) => {
      const field = shape.image.shape[key as keyof typeof shape.image.shape]
      return field?.safeParse(value).success
    })
  )
  return designDocumentSchema.parse({ ...raw, image: imageFields })
}

/** Which layer the user has selected, for scoping AI edits to it. */
export function describeSelection(): { kind: string; label: string } | null {
  const image = useImageStore.getState()
  // Text selection lives in the canvas component; the selected text layer
  // marks itself in the DOM, which is enough to scope an edit to it.
  const selectedText = document.querySelector<HTMLElement>(
    '[data-text-overlay-id][data-export-clean-outline="true"]'
  )?.dataset.textOverlayId
  if (selectedText) {
    const index = image.textOverlays.findIndex((text) => text.id === selectedText)
    if (index >= 0) {
      return {
        kind: 'text',
        label: `texts[${index}] ("${image.textOverlays[index]!.text.slice(0, 60)}")`,
      }
    }
  }
  const selectedDevice = useDeviceUIStore.getState().selectedDeviceId
  if (selectedDevice) {
    const index = image.mockups.findIndex((mockup) => mockup.id === selectedDevice)
    if (index >= 0) {
      return {
        kind: 'device',
        label: `devices.mockups[${index}] (${image.mockups[index]!.definitionId})`,
      }
    }
  }
  if (image.selectedAnnotationId) {
    const index = image.annotations.findIndex((shape) => shape.id === image.selectedAnnotationId)
    if (index >= 0)
      return {
        kind: 'annotation',
        label: `annotations[${index}] (${image.annotations[index]!.type})`,
      }
  }
  if (image.selectedOverlayId) {
    const textIndex = image.textOverlays.findIndex((text) => text.id === image.selectedOverlayId)
    if (textIndex >= 0) {
      return {
        kind: 'text',
        label: `texts[${textIndex}] ("${image.textOverlays[textIndex]!.text.slice(0, 60)}")`,
      }
    }
    const overlayIndex = image.imageOverlays
      .filter((overlay) => !overlay.id.startsWith('template-shadow-'))
      .findIndex((overlay) => overlay.id === image.selectedOverlayId)
    if (overlayIndex >= 0) return { kind: 'overlay', label: `overlays[${overlayIndex}]` }
  }
  if (image.isMainImageSelected) return { kind: 'image', label: 'the main image (image section)' }
  return null
}

/**
 * A small JPEG of the canvas, for the model to see what it changed. Uses the
 * editor's own export so the snapshot matches what the user would export.
 */
export async function captureCanvasSnapshot(maxWidth = 1024): Promise<string | null> {
  const image = useImageStore.getState()
  const preset = getAspectRatioPreset(image.selectedAspectRatio)
  if (!preset || !document.getElementById('image-render-card')) return null
  const scale = Math.min(1, maxWidth / preset.width)
  try {
    const canvas = await exportElementAsCanvas(
      'image-render-card',
      {
        exportHeight: Math.round(preset.height * scale),
        exportWidth: Math.round(preset.width * scale),
        format: 'jpeg',
        qualityPreset: 'medium',
        scale: 1,
        skipSharp: true,
      },
      getCanvasContainer(),
      image.backgroundBorderRadius,
      image.perspective3D,
      useEditorStore.getState().screenshot.src || undefined
    )
    return canvas.toDataURL('image/jpeg', 0.72).split(',')[1] ?? null
  } catch {
    return null
  }
}
