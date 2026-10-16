'use client'

import { detectSensitiveText, type Finding, type OcrWord } from './patterns'

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
async function readWords(canvas: HTMLCanvasElement, onProgress: (progress: number) => void): Promise<OcrWord[]> {
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
              words.push({ bbox: word.bbox, confidence: word.confidence, line, text: word.text.trim() })
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

async function findFaces(canvas: HTMLCanvasElement): Promise<Finding[]> {
  const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision')
  const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM)
  const detector = await FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_MODEL },
    minDetectionConfidence: MIN_FACE_SCORE,
    runningMode: 'IMAGE',
  })
  try {
    const { detections } = detector.detect(canvas)
    return detections.flatMap((detection, index) => {
      const box = detection.boundingBox
      if (!box) return []
      // The detector's box is tight to the face; grow it to cover hair and chin.
      const padX = box.width * 0.25
      const padY = box.height * 0.3
      const x = Math.max(0, box.originX - padX)
      const y = Math.max(0, box.originY - padY)
      return [
        {
          box: {
            height: (Math.min(canvas.height, box.originY + box.height + padY) - y) / canvas.height,
            width: (Math.min(canvas.width, box.originX + box.width + padX) - x) / canvas.width,
            x: x / canvas.width,
            y: y / canvas.height,
          },
          confidence: Math.round((detection.categories[0]?.score ?? MIN_FACE_SCORE) * 100) / 100,
          id: `face-${index}`,
          kind: 'face' as const,
          label: 'Face',
        },
      ]
    })
  } finally {
    detector.close()
  }
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
    warnings.push(`Face detection is unavailable (${error instanceof Error ? error.message : 'load failed'}).`)
    return [] as Finding[]
  })
  signal?.throwIfAborted()

  onProgress({ message: 'Loading text recognition', progress: 0.15 })
  const words = await readWords(canvas, (progress) =>
    onProgress({ message: 'Reading text', progress: 0.2 + progress * 0.75 })
  ).catch((error: unknown) => {
    warnings.push(`Text recognition is unavailable (${error instanceof Error ? error.message : 'load failed'}).`)
    return [] as OcrWord[]
  })
  signal?.throwIfAborted()

  const findings = [...faces, ...detectSensitiveText(words, canvas)]
    .sort((a, b) => b.confidence - a.confidence)
    .map((finding, index) => ({ ...finding, id: `${finding.kind}-${index}` }))
  onProgress({ message: 'Done', progress: 1 })
  return { findings, height: canvas.height, warnings, width: canvas.width }
}
