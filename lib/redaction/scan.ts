'use client'

import { detectSensitiveText, type Finding, type ImageBox, type OcrWord } from './patterns'

/**
 * Scan a screenshot for sensitive content, entirely in this browser: the
 * image is never uploaded. Text is read with Tesseract (OCR) and checked by
 * `detectSensitiveText`; faces come from MediaPipe's face detector. Both
 * engines load on first use; their code and model files come from public
 * CDNs pinned to the installed versions (the face model is served by this
 * app), but no image data leaves the device.
 */

/** The face detector runtime, pinned to the installed @mediapipe/tasks-vision. */
const MEDIAPIPE_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm'
const FACE_MODEL = '/models/blaze_face_short_range.tflite'
/** Faces below this detector score are not suggested. */
const MIN_FACE_SCORE = 0.5

/** Progress of a scan, for the review dialog. */
export type ScanProgress = { message: string; progress: number }

/** A scan's findings and the size of the image they refer to. */
export type ScanResult = { findings: Finding[]; height: number; width: number }

async function loadCanvas(src: string): Promise<HTMLCanvasElement> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = src
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable.')
  context.drawImage(image, 0, 0)
  return canvas
}

/** OCR words with their line index, in reading order. */
async function readWords(
  canvas: HTMLCanvasElement,
  onProgress: (progress: number) => void
): Promise<OcrWord[]> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng', 1, {
    logger: (message: { progress: number; status: string }) => {
      if (message.status === 'recognizing text') onProgress(message.progress)
    },
  })
  try {
    const { data } = await worker.recognize(canvas, {}, { blocks: true })
    const words: OcrWord[] = []
    let line = 0
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const textLine of paragraph.lines) {
          for (const word of textLine.words) {
            if (word.text.trim()) {
              words.push({
                bbox: word.bbox,
                confidence: word.confidence,
                line,
                text: word.text.trim(),
              })
            }
          }
          line++
        }
      }
    }
    return words
  } finally {
    await worker.terminate()
  }
}

/**
 * Square tiles covering the image at several scales, overlapping by a
 * quarter. The face model expects a face to fill much of its input, so
 * small faces (avatars, people in a page) are only found in the smaller tiles.
 */
export function faceTiles(width: number, height: number, grids: readonly number[] = [1, 2, 3, 5]) {
  const tiles: { size: number; x: number; y: number }[] = []
  for (const grid of grids) {
    const size = Math.min(width, height, Math.ceil(Math.max(width, height) / grid / 0.75))
    const stepX =
      width > size ? (width - size) / Math.max(1, Math.ceil((width - size) / (size * 0.75))) : 1
    const stepY =
      height > size ? (height - size) / Math.max(1, Math.ceil((height - size) / (size * 0.75))) : 1
    for (let y = 0; y <= Math.max(0, height - size) + 0.5; y += stepY) {
      for (let x = 0; x <= Math.max(0, width - size) + 0.5; x += stepX) {
        tiles.push({ size, x: Math.round(x), y: Math.round(y) })
      }
    }
  }
  return tiles
}

/** Overlap of two boxes as intersection over union. */
export function overlap(a: ImageBox, b: ImageBox): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const intersection = x * y
  return intersection / (a.width * a.height + b.width * b.height - intersection || 1)
}

async function findFaces(canvas: HTMLCanvasElement): Promise<Finding[]> {
  const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision')
  const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM)
  const detector = await FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_MODEL },
    minDetectionConfidence: MIN_FACE_SCORE,
    runningMode: 'IMAGE',
  })
  const tile = document.createElement('canvas')
  const tileContext = tile.getContext('2d')!
  const found: { box: ImageBox; score: number }[] = []
  try {
    for (const { size, x, y } of faceTiles(canvas.width, canvas.height)) {
      tile.width = size
      tile.height = size
      tileContext.drawImage(canvas, x, y, size, size, 0, 0, size, size)
      for (const detection of detector.detect(tile).detections) {
        const box = detection.boundingBox
        if (!box) continue
        // The detector's box is tight to the face; grow it to cover hair and chin.
        const padX = box.width * 0.25
        const padY = box.height * 0.3
        const left = Math.max(0, x + box.originX - padX)
        const top = Math.max(0, y + box.originY - padY)
        found.push({
          box: {
            height:
              (Math.min(canvas.height, y + box.originY + box.height + padY) - top) / canvas.height,
            width:
              (Math.min(canvas.width, x + box.originX + box.width + padX) - left) / canvas.width,
            x: left / canvas.width,
            y: top / canvas.height,
          },
          score: detection.categories[0]?.score ?? MIN_FACE_SCORE,
        })
      }
    }
  } finally {
    detector.close()
  }
  // The same face is found in several tiles: keep the most confident of each.
  const kept: typeof found = []
  for (const face of found.sort((a, b) => b.score - a.score)) {
    if (!kept.some((other) => overlap(other.box, face.box) > 0.3)) kept.push(face)
  }
  return kept.map((face, index) => ({
    box: face.box,
    confidence: Math.round(face.score * 100) / 100,
    id: `face-${index}`,
    kind: 'face' as const,
    label: 'Face',
  }))
}

/**
 * Scan an image. Text and faces are found independently: if one engine
 * fails to load, the other's findings are still returned with a warning.
 */
export async function scanImage(
  src: string,
  onProgress: (progress: ScanProgress) => void,
  signal?: AbortSignal
): Promise<ScanResult & { warnings: string[] }> {
  onProgress({ message: 'Reading the screenshot', progress: 0.02 })
  const canvas = await loadCanvas(src)
  signal?.throwIfAborted()
  const warnings: string[] = []

  onProgress({ message: 'Finding faces', progress: 0.05 })
  const faces = await findFaces(canvas).catch((error: unknown) => {
    warnings.push(
      `Face detection is unavailable (${error instanceof Error ? error.message : 'load failed'}).`
    )
    return [] as Finding[]
  })
  signal?.throwIfAborted()

  onProgress({ message: 'Loading text recognition', progress: 0.15 })
  const words = await readWords(canvas, (progress) =>
    onProgress({ message: 'Reading text', progress: 0.2 + progress * 0.75 })
  ).catch((error: unknown) => {
    warnings.push(
      `Text recognition is unavailable (${error instanceof Error ? error.message : 'load failed'}).`
    )
    return [] as OcrWord[]
  })
  signal?.throwIfAborted()

  const findings = [...faces, ...detectSensitiveText(words, canvas)]
    .sort((a, b) => b.confidence - a.confidence)
    .map((finding, index) => ({ ...finding, id: `${finding.kind}-${index}` }))
  onProgress({ message: 'Done', progress: 1 })
  return { findings, height: canvas.height, warnings, width: canvas.width }
}
