/**
 * A minimal PNG encoder that writes 8-bit RGB (colour type 2) with an sRGB
 * chunk. Both stores reject screenshots with an alpha channel, and browser
 * canvas encoders always write RGBA, so exports are re-encoded here.
 * Compression uses the platform's `CompressionStream('deflate')`, which
 * produces the zlib stream PNG requires; it runs in browsers and Node.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Encode RGBA pixels as an RGB PNG. Pixels are composited over `matte`
 * (default white) so any transparency becomes the matte colour instead of
 * black. Rows use the Up filter (Sub for the first row).
 */
export async function encodeRgbPng(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  matte: [number, number, number] = [255, 255, 255]
): Promise<Uint8Array> {
  const stride = width * 3
  const raw = new Uint8Array((stride + 1) * height)
  const previous = new Uint8Array(stride)
  const current = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4
      const alpha = rgba[source + 3] / 255
      current[x * 3] = Math.round(rgba[source] * alpha + matte[0] * (1 - alpha))
      current[x * 3 + 1] = Math.round(rgba[source + 1] * alpha + matte[1] * (1 - alpha))
      current[x * 3 + 2] = Math.round(rgba[source + 2] * alpha + matte[2] * (1 - alpha))
    }
    const row = y * (stride + 1)
    if (y === 0) {
      raw[row] = 1
      for (let index = 0; index < stride; index += 1) raw[row + 1 + index] = (current[index] - (index >= 3 ? current[index - 3] : 0)) & 0xff
    } else {
      raw[row] = 2
      for (let index = 0; index < stride; index += 1) raw[row + 1 + index] = (current[index] - previous[index]) & 0xff
    }
    previous.set(current)
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8
  header[9] = 2
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('sRGB', new Uint8Array([0])),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Read width, height, and colour type from a PNG header; null if not a PNG. */
export function readPngHeader(bytes: Uint8Array): { width: number; height: number; colorType: number; bitDepth: number } | null {
  if (bytes.length < 26 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20), bitDepth: bytes[24], colorType: bytes[25] }
}
