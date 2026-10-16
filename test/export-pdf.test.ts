import assert from 'node:assert/strict'
import test from 'node:test'
import { inflateSync } from 'node:zlib'
import { deflate, rgbOnWhite, writePdf, type PdfPage } from '@/lib/export/pdf'

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')

/** A tiny JPEG stand-in: the writer embeds bytes as they are, so any payload works. */
const jpegPage = (width: number, height: number): PdfPage => ({
  height,
  image: {
    data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    filter: 'DCTDecode',
    height: 2,
    width: 3,
  },
  width,
})

test('a PDF has exact page sizes, one page per entry, and a valid cross-reference table', async () => {
  const flate = await deflate(rgbOnWhite(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255])))
  const pdf = writePdf(
    [
      jpegPage(1920, 1080),
      {
        height: 1920,
        image: { data: flate, filter: 'FlateDecode', height: 1, width: 2 },
        width: 1080,
      },
    ],
    { title: 'Launch (v2) \\ draft' }
  )
  const text = latin1(pdf)
  assert.ok(text.startsWith('%PDF-1.4\n'))
  assert.ok(text.endsWith('%%EOF\n'))
  assert.match(text, /\/Type \/Pages \/Kids \[4 0 R 7 0 R\] \/Count 2/)
  const boxes = [...text.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((match) => [
    Number(match[1]),
    Number(match[2]),
  ])
  assert.deepEqual(boxes, [
    [1920, 1080],
    [1080, 1920],
  ])
  assert.match(
    text,
    /\/Width 3 \/Height 2 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode \/Length 4/
  )
  assert.match(text, /\/Filter \/FlateDecode/)
  assert.match(text, /\/Title \(Launch \\\(v2\\\) \\\\ draft\)/)

  // startxref points at the table, and every entry points at its object.
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1])
  assert.equal(text.slice(startxref, startxref + 4), 'xref')
  const [, size] = /xref\n0 (\d+)\n/.exec(text.slice(startxref))!
  assert.equal(Number(size), 10)
  const rows = text
    .slice(startxref)
    .split('\n')
    .slice(2, 2 + Number(size))
  rows.slice(1).forEach((row, index) => {
    const offset = Number(row.slice(0, 10))
    assert.equal(text.slice(offset, offset + `${index + 1} 0 obj`.length), `${index + 1} 0 obj`)
  })
  // Each stream's /Length is its exact byte count.
  for (const match of text.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
    const start = match.index! + match[0].length
    assert.equal(text.slice(start + Number(match[1]), start + Number(match[1]) + 10), '\nendstream')
  }
})

test('lossless pages are zlib streams of RGB composited on white', async () => {
  const opaqueRed = [255, 0, 0, 255]
  const transparent = [0, 0, 0, 0]
  const halfBlack = [0, 0, 0, 128]
  const rgba = new Uint8Array([...opaqueRed, ...transparent, ...halfBlack])
  const rgb = rgbOnWhite(rgba)
  assert.deepEqual([...rgb], [255, 0, 0, 255, 255, 255, 127, 127, 127])
  assert.deepEqual([...inflateSync(await deflate(rgb))], [...rgb])
})

test('the writer refuses pages it cannot describe', () => {
  assert.throws(() => writePdf([]), /at least one page/)
  assert.throws(() => writePdf([jpegPage(0, 100)]), /positive size/)
  const page = jpegPage(100, 100)
  assert.throws(
    () => writePdf([{ ...page, image: { ...page.image, width: 1.5 } }]),
    /whole, positive pixel/
  )
})
