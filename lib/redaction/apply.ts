'use client'

import { z } from 'zod'
import { useImageStore, withHistoryStep } from '@/lib/store'
import type { ImageBox } from './patterns'

/**
 * Apply redactions to the screenshot's own pixels. The redacted image
 * replaces the original wherever the design uses it, so no export, preview,
 * share link, or server render can contain the covered pixels: there is no
 * overlay to remove. The original stays reachable only through undo.
 */

/** How a region is redacted. */
export const redactionMethodSchema = z.enum(['cover', 'pixelate', 'blur'])
/** A redaction method. */
export type RedactionMethod = z.infer<typeof redactionMethodSchema>

/** One region to redact, as fractions of the image. */
export type RedactionRegion = { box: ImageBox; method: RedactionMethod }

/**
 * The strength a method needs to make a region unreadable: pixel blocks or a
 * blur radius of at least a third (blocks) or half (blur) of the region's
 * shorter side, and never below 10 px, so text and faces cannot be read back.
 */
export function redactionStrength(method: RedactionMethod, width: number, height: number): number {
  const shorter = Math.max(1, Math.min(width, height))
  if (method === 'pixelate') return Math.max(10, Math.round(shorter / 3))
  if (method === 'blur') return Math.max(10, Math.round(shorter / 2))
  return 0
}

/** A region's rectangle in image pixels, clamped to the image. */
export function regionPixels(box: ImageBox, width: number, height: number) {
  const x = Math.max(0, Math.floor(box.x * width))
  const y = Math.max(0, Math.floor(box.y * height))
  return {
    height: Math.max(1, Math.min(height, Math.ceil((box.y + box.height) * height)) - y),
    width: Math.max(1, Math.min(width, Math.ceil((box.x + box.width) * width)) - x),
    x,
    y,
  }
}

/** Draw the image with every region destroyed, and return it as a PNG. */
export async function redactImage(src: string, regions: readonly RedactionRegion[], coverColor = '#000000'): Promise<Blob> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = src
  await image.decode()
  const { naturalHeight: height, naturalWidth: width } = image
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable.')
  context.drawImage(image, 0, 0)

  for (const { box, method } of regions) {
    const rect = regionPixels(box, width, height)
    const strength = redactionStrength(method, rect.width, rect.height)
    if (method === 'cover') {
      context.fillStyle = coverColor
      context.fillRect(rect.x, rect.y, rect.width, rect.height)
      continue
    }
    // Work on a copy of the region only, so nothing outside it is sampled in.
    const region = document.createElement('canvas')
    region.width = rect.width
    region.height = rect.height
    const regionContext = region.getContext('2d')!
    regionContext.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
    if (method === 'pixelate') {
      const columns = Math.max(1, Math.ceil(rect.width / strength))
      const rows = Math.max(1, Math.ceil(rect.height / strength))
      const small = document.createElement('canvas')
      small.width = columns
      small.height = rows
      small.getContext('2d')!.drawImage(region, 0, 0, columns, rows)
      context.imageSmoothingEnabled = false
      context.drawImage(small, 0, 0, columns, rows, rect.x, rect.y, rect.width, rect.height)
      context.imageSmoothingEnabled = true
    } else {
      // Blur the downsampled region too: a heavy blur of averaged blocks cannot be inverted.
      const small = document.createElement('canvas')
      small.width = Math.max(1, Math.ceil(rect.width / 8))
      small.height = Math.max(1, Math.ceil(rect.height / 8))
      small.getContext('2d')!.drawImage(region, 0, 0, small.width, small.height)
      context.save()
      context.beginPath()
      context.rect(rect.x, rect.y, rect.width, rect.height)
      context.clip()
      context.filter = `blur(${strength}px)`
      context.drawImage(small, 0, 0, small.width, small.height, rect.x - strength, rect.y - strength, rect.width + strength * 2, rect.height + strength * 2)
      context.restore()
    }
  }
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the redacted image.'))), 'image/png')
  )
}

/**
 * Put a redacted image in place of the screenshot: the main image, every
 * device screen and slide that shows it. One undo step.
 */
export function replaceScreenshotEverywhere(previousUrl: string, nextUrl: string) {
  withHistoryStep(() =>
    useImageStore.setState((state) => ({
      mockups: state.mockups.map((mockup) =>
        mockup.screen.src === previousUrl ? { ...mockup, screen: { ...mockup.screen, src: nextUrl } } : mockup
      ),
      deviceLayoutSnapshot: state.deviceLayoutSnapshot?.map((mockup) =>
        mockup.screen.src === previousUrl ? { ...mockup, screen: { ...mockup.screen, src: nextUrl } } : mockup
      ) ?? null,
      imageOverlays: state.imageOverlays.map((overlay) => overlay.src === previousUrl ? { ...overlay, src: nextUrl } : overlay),
      slides: state.slides.map((slide) => (slide.src === previousUrl ? { ...slide, src: nextUrl } : slide)),
      uploadedImageUrl: state.uploadedImageUrl === previousUrl ? nextUrl : state.uploadedImageUrl,
    }))
  )
}
