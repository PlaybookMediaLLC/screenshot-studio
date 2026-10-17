'use client'

import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { domToCanvas } from 'modern-screenshot'
import type { AnimationLayer } from '@/lib/store-screenshots/animation/timeline'
import type { Scene } from '@/lib/store-screenshots/engine/scene'
import { encodeRgbPng } from '@/lib/store-screenshots/export/png'
import type { ImageFormat } from '@/lib/store-screenshots/targets'
import { SlideRender, type AssetResolver } from './SlideRender'

/**
 * Turns a scene into pixels with the same renderer the editor shows. The
 * slide is mounted off screen at its exact export size, every image and
 * font is awaited, and the DOM is captured. Exports, animation frames, and
 * review snapshots all come through here.
 */

/** Raised when a capture is cancelled. */
export class CaptureAbortedError extends Error {
  /** Create a cancellation error. */
  constructor() {
    super('Cancelled')
    this.name = 'AbortError'
  }
}

async function settle(host: HTMLElement): Promise<void> {
  await document.fonts.ready
  const images = Array.from(host.querySelectorAll('img'))
  await Promise.all(
    images.map(async (image) => {
      if (!image.complete) {
        await new Promise<void>((resolve, reject) => {
          image.addEventListener('load', () => resolve(), { once: true })
          image.addEventListener('error', () => reject(new Error(`An image could not be loaded (${image.src.slice(0, 60)}).`)), { once: true })
        })
      }
      await image.decode().catch(() => undefined)
    })
  )
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

/** Render a scene to a canvas at its native size. */
export async function renderSceneToCanvas(
  scene: Scene,
  resolveAsset: AssetResolver,
  options: { signal?: AbortSignal; hiddenLayerIds?: ReadonlySet<string>; only?: AnimationLayer } = {}
): Promise<HTMLCanvasElement> {
  if (options.signal?.aborted) throw new CaptureAbortedError()
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.setAttribute('data-store-capture', '')
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${scene.width}px`,
    height: `${scene.height}px`,
    pointerEvents: 'none',
    overflow: 'hidden',
  })
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    flushSync(() => root.render(<SlideRender scene={scene} resolveAsset={resolveAsset} hiddenLayerIds={options.hiddenLayerIds} only={options.only} />))
    await settle(host)
    if (options.signal?.aborted) throw new CaptureAbortedError()
    const node = host.firstElementChild as HTMLElement
    const transparent = options.only === 'content' || options.only === 'text'
    return await domToCanvas(node, { width: scene.width, height: scene.height, scale: 1, backgroundColor: transparent ? undefined : '#FFFFFF', timeout: 60_000 })
  } finally {
    root.unmount()
    host.remove()
  }
}

/** Encode a canvas: RGB PNG without alpha, or JPEG at a quality. */
export async function encodeCanvas(canvas: HTMLCanvasElement, format: ImageFormat, quality: number): Promise<Blob> {
  if (format === 'jpeg') {
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded.'))), 'image/jpeg', quality)
    )
  }
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('The image could not be read for encoding.')
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const bytes = await encodeRgbPng(data, canvas.width, canvas.height)
  return new Blob([bytes as BlobPart], { type: 'image/png' })
}

/** Download a blob under a file name. The object URL is revoked afterwards. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2_000)
}
