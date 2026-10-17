import type { PdfCompression } from './formats'

/**
 * A minimal PDF writer: one image per page, drawn to fill the page exactly.
 * Page sizes are in points with 1 design px = 1 pt (as Figma exports PDF),
 * so a 1920×1080 design is a 1920×1080 pt page whatever the image's pixel
 * resolution; a scaled export only makes the image sharper.
 *
 * A JPEG is embedded as it is (`DCTDecode`); lossless pages store RGB bytes
 * deflated with the browser's own `CompressionStream` (`FlateDecode`), so no
 * PDF library is needed.
 */

/** An image XObject: 8-bit RGB pixels in one of the two encodings PDF reads natively. */
export type PdfImage = {
  data: Uint8Array
  filter: 'DCTDecode' | 'FlateDecode'
  /** Pixel size. */
  height: number
  width: number
}

/** One page: its size in points and the image that fills it. */
export type PdfPage = { height: number; image: PdfImage; width: number }

/** Document metadata. */
export type PdfInfo = { title?: string }

const encoder = new TextEncoder()

/** A number as PDF writes it: at most three decimals, no exponent. */
function pdfNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('PDF sizes must be finite numbers.')
  return String(Math.round(value * 1000) / 1000)
}

/** A PDF literal string of printable ASCII, with its delimiters escaped. */
function pdfText(value: string): string {
  const ascii = value.replace(/[^\x20-\x7e]/g, '?').slice(0, 200)
  return `(${ascii.replace(/[\\()]/g, (char) => `\\${char}`)})`
}

/** Write a PDF with one page per entry, in order. */
export function writePdf(pages: readonly PdfPage[], info: PdfInfo = {}): Uint8Array<ArrayBuffer> {
  if (pages.length === 0) throw new Error('A PDF needs at least one page.')
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (bytes: Uint8Array) => {
    chunks.push(bytes)
    length += bytes.length
  }
  const text = (value: string) => push(encoder.encode(value))
  /** Write object `id` (1-based); objects are written in id order. */
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length
    text(`${id} 0 obj\n${body}\n`)
    if (stream) {
      text('stream\n')
      push(stream)
      text('\nendstream\n')
    }
    text('endobj\n')
  }

  // 1 catalog, 2 page tree, 3 info, then three objects per page: page, contents, image.
  const pageId = (index: number) => 4 + index * 3
  const count = 3 + pages.length * 3

  // The second line's high bytes mark the file as binary for transfer tools.
  text('%PDF-1.4\n')
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(
    2,
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${pageId(index)} 0 R`).join(' ')}] /Count ${pages.length} >>`
  )
  object(
    3,
    `<< /Producer (Screenshot Studio)${info.title ? ` /Title ${pdfText(info.title)}` : ''} >>`
  )
  pages.forEach((page, index) => {
    const id = pageId(index)
    if (!(page.width > 0 && page.height > 0)) throw new Error('PDF pages need a positive size.')
    const width = pdfNumber(page.width)
    const height = pdfNumber(page.height)
    const { image } = page
    if (
      !Number.isInteger(image.width) ||
      !Number.isInteger(image.height) ||
      image.width < 1 ||
      image.height < 1
    ) {
      throw new Error('PDF images need a whole, positive pixel size.')
    }
    const contents = encoder.encode(`q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`)
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /XObject << /Im0 ${id + 2} 0 R >> /ProcSet [/PDF /ImageC] >> ` +
        `/Contents ${id + 1} 0 R >>`
    )
    object(id + 1, `<< /Length ${contents.length} >>`, contents)
    object(
      id + 2,
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${image.filter} /Length ${image.data.length} >>`,
      image.data
    )
  })

  const xref = length
  const rows = ['0000000000 65535 f ']
  for (let id = 1; id <= count; id++) rows.push(`${String(offsets[id]).padStart(10, '0')} 00000 n `)
  text(`xref\n0 ${count + 1}\n${rows.join('\n')}\n`)
  text(`trailer\n<< /Size ${count + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const output = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    output.set(chunk, at)
    at += chunk.length
  }
  return output
}

/** zlib-deflate bytes with the platform's CompressionStream (what PDF's FlateDecode reads). */
export async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** RGBA pixels as RGB, composited on white (PDF pages have no transparency). */
export function rgbOnWhite(rgba: Uint8ClampedArray | Uint8Array): Uint8Array<ArrayBuffer> {
  const rgb = new Uint8Array((rgba.length / 4) * 3)
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
    const alpha = rgba[source + 3]! / 255
    rgb[target] = Math.round(rgba[source]! * alpha + 255 * (1 - alpha))
    rgb[target + 1] = Math.round(rgba[source + 1]! * alpha + 255 * (1 - alpha))
    rgb[target + 2] = Math.round(rgba[source + 2]! * alpha + 255 * (1 - alpha))
  }
  return rgb
}

/**
 * A page image from a rendered capture, composited on white: re-encoded as
 * JPEG (`quality` 0-1) or stored losslessly. Browser only.
 */
export async function pdfImageFromBlob(
  blob: Blob,
  compression: PdfCompression,
  quality: number
): Promise<PdfImage> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The browser could not prepare the PDF page.')
    const size = { height: bitmap.height, width: bitmap.width }
    if (compression === 'jpeg') {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0)
      const jpeg = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) =>
            result
              ? resolve(result)
              : reject(new Error('The browser could not encode the PDF page.')),
          'image/jpeg',
          quality
        )
      )
      return { ...size, data: new Uint8Array(await jpeg.arrayBuffer()), filter: 'DCTDecode' }
    }
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    return { ...size, data: await deflate(rgbOnWhite(pixels)), filter: 'FlateDecode' }
  } finally {
    bitmap.close()
  }
}
