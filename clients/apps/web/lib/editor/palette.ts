/**
 * The main colours of an image, for palettes drawn from a screenshot. Pixels
 * are bucketed at 4 bits per channel, the busiest buckets win, and colours
 * too close to one already picked are skipped so the palette has range.
 */

const toHex = (value: number) => Math.round(value).toString(16).padStart(2, '0')

/** Up to `count` dominant colours of RGBA pixels, as #rrggbb, most common first. */
export function dominantColors(pixels: Uint8ClampedArray, count = 5, minDistance = 48): string[] {
  const buckets = new Map<number, { b: number; count: number; g: number; r: number }>()
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3]! < 128) continue
    const r = pixels[index]!
    const g = pixels[index + 1]!
    const b = pixels[index + 2]!
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.r += r
      bucket.g += g
      bucket.b += b
      bucket.count++
    } else {
      buckets.set(key, { b, count: 1, g, r })
    }
  }
  const picked: Array<[number, number, number]> = []
  for (const bucket of [...buckets.values()].sort((a, b) => b.count - a.count)) {
    const color: [number, number, number] = [
      bucket.r / bucket.count,
      bucket.g / bucket.count,
      bucket.b / bucket.count,
    ]
    if (
      picked.some(
        (other) =>
          Math.hypot(other[0] - color[0], other[1] - color[1], other[2] - color[2]) < minDistance
      )
    )
      continue
    picked.push(color)
    if (picked.length === count) break
  }
  return picked.map(([r, g, b]) => `#${toHex(r)}${toHex(g)}${toHex(b)}`)
}

/** The dominant colours of an image URL, read from a small copy of it. */
export async function imagePalette(src: string, count = 5): Promise<string[]> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = src
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = Math.max(1, Math.round((96 * image.naturalHeight) / image.naturalWidth))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return []
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return dominantColors(context.getImageData(0, 0, canvas.width, canvas.height).data, count)
}
