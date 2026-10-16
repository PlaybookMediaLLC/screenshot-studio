'use client'

import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_SIZE } from '@/lib/constants'
import { useImageStore } from '@/lib/store'
import { isTemplateDemoMedia } from '@/lib/templates/demo-media'

/**
 * The one command behind every paste, drop, and file pick in the editor.
 *
 * Each import decides its target from the store at the moment it runs, never
 * later, so two quick pastes cannot both see an empty canvas, and nothing else
 * may also handle the same event: callers mark their drop roots
 * `data-local-dropzone` and stop the event once this has run.
 */

/** Where one import's images go. */
export type ImageImportTarget =
  /** The first image becomes the main image; the rest join it as slides. */
  | 'main'
  /** The template's demo image is swapped for the first image, keeping the template. */
  | 'template-media'
  /** Each image becomes one new layer over the existing composition. */
  | 'layers'

/** Decide where an import goes, from the canvas as it is right now. */
export function planImageImport(canvas: {
  uploadedImageUrl: string | null
  imageName: string | null
}): ImageImportTarget {
  if (!canvas.uploadedImageUrl) return 'main'
  if (isTemplateDemoMedia(canvas.uploadedImageUrl, canvas.imageName)) return 'template-media'
  return 'layers'
}

/** A user-facing reason the file cannot be imported, or null when it can. */
export function validateImageFile(file: { size: number; type: string }): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return 'File type not supported. Use PNG, JPG, or WEBP.'
  if (file.size > MAX_IMAGE_SIZE) return `File too large. Max ${MAX_IMAGE_SIZE / 1024 / 1024}MB.`
  return null
}

/** Pasted and dropped layers start at this width, in stage px. */
const LAYER_SIZE = 250
/** Each further layer in one import is offset by this much, so none hide another. */
const LAYER_CASCADE = 24

export type ImageImportResult = {
  imported: number
  rejected: { name: string; reason: string }[]
  target: ImageImportTarget
}

/** Import images into the editor as one undoable step. */
export function importImages(files: readonly File[]): ImageImportResult {
  const rejected: ImageImportResult['rejected'] = []
  const accepted = files.filter((file) => {
    const reason = validateImageFile(file)
    if (reason) rejected.push({ name: file.name, reason })
    return !reason
  })
  const state = useImageStore.getState()
  const target = planImageImport(state)
  if (accepted.length === 0) return { imported: 0, rejected, target }

  if (target === 'main') {
    state.addImages([...accepted])
  } else if (target === 'template-media') {
    const [first] = accepted
    state.replaceTemplateMedia(URL.createObjectURL(first), first.name)
  } else {
    const canvas = state.canvasDimensions ?? { canvasW: 800, canvasH: 600 }
    accepted.forEach((file, index) => {
      state.addImageOverlay({
        src: URL.createObjectURL(file),
        position: {
          x: canvas.canvasW / 2 + index * LAYER_CASCADE,
          y: canvas.canvasH / 2 + index * LAYER_CASCADE,
        },
        size: LAYER_SIZE,
        rotation: 0,
        opacity: 1,
        flipX: false,
        flipY: false,
        isVisible: true,
        isCustom: true,
      })
    })
  }
  return { imported: target === 'template-media' ? 1 : accepted.length, rejected, target }
}

/**
 * The image files on a paste or drop, in order. `files` lists each file once;
 * `items` can carry one image in several formats, which must not import twice.
 */
export function transferImageFiles(data: Pick<DataTransfer, 'files'> | null): File[] {
  return Array.from(data?.files ?? []).filter((file) => file.type.startsWith('image/'))
}
