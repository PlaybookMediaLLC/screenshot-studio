import { readFile } from 'node:fs/promises'
import type { Download, Page } from '@playwright/test'
import JSZip from 'jszip'
import { signUpAndCreateWorkspace } from './framework/auth'
import { configureE2EFlow, expect, test } from './framework/flow'

configureE2EFlow()

/** The editor's default canvas (4:3). */
const CANVAS = { height: 1440, width: 1920 }

// ── Byte-level readers: what a file really is, not what its name says ──────

type Size = { height: number; width: number }

function pngSize(bytes: Buffer): Size {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  expect(bytes.toString('latin1', 12, 16)).toBe('IHDR')
  return { height: bytes.readUInt32BE(20), width: bytes.readUInt32BE(16) }
}

function jpegSize(bytes: Buffer): Size {
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
  let at = 2
  while (at < bytes.length) {
    const marker = bytes[at + 1]!
    const length = bytes.readUInt16BE(at + 2)
    // Start-of-frame markers carry the size; C4, C8, and CC are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) }
    }
    at += 2 + length
  }
  throw new Error('No JPEG frame header')
}

function webpSize(bytes: Buffer): Size {
  expect(bytes.toString('latin1', 0, 4)).toBe('RIFF')
  expect(bytes.toString('latin1', 8, 12)).toBe('WEBP')
  const chunk = bytes.toString('latin1', 12, 16)
  if (chunk === 'VP8X')
    return { height: 1 + bytes.readUIntLE(27, 3), width: 1 + bytes.readUIntLE(24, 3) }
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21)
    return { height: ((bits >> 14) & 0x3fff) + 1, width: (bits & 0x3fff) + 1 }
  }
  expect(chunk).toBe('VP8 ')
  return { height: bytes.readUInt16LE(28) & 0x3fff, width: bytes.readUInt16LE(26) & 0x3fff }
}

/** A GIF's logical screen size and how many images (frames) it holds. */
function gifInfo(bytes: Buffer): Size & { frames: number } {
  expect(bytes.toString('latin1', 0, 6)).toBe('GIF89a')
  const size = { height: bytes.readUInt16LE(8), width: bytes.readUInt16LE(6) }
  const flags = bytes[10]!
  let at = 13 + (flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0)
  const skipSubBlocks = () => {
    while (bytes[at]! !== 0) at += bytes[at]! + 1
    at += 1
  }
  let frames = 0
  while (at < bytes.length) {
    const block = bytes[at]!
    if (block === 0x3b) return { ...size, frames }
    if (block === 0x21) {
      at += 2
      skipSubBlocks()
    } else if (block === 0x2c) {
      frames += 1
      const local = bytes[at + 9]!
      at += 10 + (local & 0x80 ? 3 * 2 ** ((local & 0x07) + 1) : 0) + 1
      skipSubBlocks()
    } else {
      throw new Error(`Unexpected GIF block ${block}`)
    }
  }
  throw new Error('GIF has no trailer')
}

/** An MP4's video track size, sample count, and duration, from its boxes. */
function mp4Info(bytes: Buffer): Size & { samples: number; seconds: number } {
  expect(bytes.toString('latin1', 4, 8)).toBe('ftyp')
  const find = (start: number, end: number, path: string[]): number | null => {
    let at = start
    while (at + 8 <= end) {
      const size = bytes.readUInt32BE(at)
      const type = bytes.toString('latin1', at + 4, at + 8)
      if (type === path[0]) return path.length === 1 ? at : find(at + 8, at + size, path.slice(1))
      if (size < 8) break
      at += size
    }
    return null
  }
  const tkhd = find(0, bytes.length, ['moov', 'trak', 'tkhd'])!
  const tkhdEnd = tkhd + bytes.readUInt32BE(tkhd)
  const mdhd = find(0, bytes.length, ['moov', 'trak', 'mdia', 'mdhd'])!
  const stsz = find(0, bytes.length, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsz'])!
  // mdhd version 0: timescale at +20, duration at +24.
  const seconds = bytes.readUInt32BE(mdhd + 24) / bytes.readUInt32BE(mdhd + 20)
  return {
    height: bytes.readUInt32BE(tkhdEnd - 4) / 65536,
    samples: bytes.readUInt32BE(stsz + 16),
    seconds,
    width: bytes.readUInt32BE(tkhdEnd - 8) / 65536,
  }
}

function pdfPages(bytes: Buffer): Size[] {
  expect(bytes.toString('latin1', 0, 5)).toBe('%PDF-')
  expect(bytes.toString('latin1', bytes.length - 6)).toBe('%%EOF\n')
  return [...bytes.toString('latin1').matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(
    (match) => ({
      height: Number(match[2]),
      width: Number(match[1]),
    })
  )
}

async function bytesOf(download: Download): Promise<Buffer> {
  return readFile((await download.path())!)
}

// ── Editor helpers ──────────────────────────────────────────────────────────

/** Drop a generated screenshot (a fake app page) of the given size on the empty canvas. */
async function dropScreenshot(page: Page, size: Size) {
  await page.evaluate(async ({ height, width }) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')!
    context.fillStyle = '#f8fafc'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#2563eb'
    context.fillRect(0, 0, width, height * 0.12)
    context.fillStyle = '#0f172a'
    context.font = `${Math.round(height * 0.06)}px sans-serif`
    context.fillText('Dashboard', width * 0.05, height * 0.3)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((png) => resolve(png!)))
    const data = new DataTransfer()
    data.items.add(new File([blob], 'dashboard.png', { type: 'image/png' }))
    document
      .querySelector('[data-local-dropzone]')!
      .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
  }, size)
  await expect(page.locator('img[alt="Main image"]')).toHaveCount(1)
}

async function openSave(page: Page) {
  await page.getByRole('button', { exact: true, name: 'Export' }).click()
  await expect(page.getByRole('group', { name: 'Format' })).toBeVisible()
}

async function pickFormat(page: Page, label: string) {
  await page
    .getByRole('group', { name: 'Format' })
    .getByRole('button', { exact: true, name: label })
    .click()
}

/** Click the export action and return the download it produces. */
async function exportDownload(
  page: Page,
  action: string | RegExp,
  timeout = 60_000
): Promise<Download> {
  const download = page.waitForEvent('download', { timeout })
  await page.getByRole('button', { name: action }).click()
  return download
}

/** Drop generated screenshots of the given sizes on the batch workspace. */
async function dropIntoBatch(page: Page, sizes: readonly Size[]) {
  await page.evaluate(async (sizes) => {
    const data = new DataTransfer()
    for (const [index, { height, width }] of sizes.entries()) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')!
      context.fillStyle = `hsl(${index * 70}, 80%, 92%)`
      context.fillRect(0, 0, width, height)
      context.fillStyle = '#0f172a'
      context.font = `${Math.round(height * 0.07)}px sans-serif`
      context.fillText(`Screen ${index + 1}`, width * 0.08, height * 0.35)
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((png) => resolve(png!)))
      data.items.add(new File([blob], `screen ${index + 1}.png`, { type: 'image/png' }))
    }
    document
      .querySelector('[data-batch-dropzone]')!
      .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
  }, sizes)
}

test('batch mode applies the design to several screenshots and exports every size as a ZIP', async ({
  identity,
  page,
}) => {
  test.setTimeout(360_000)
  await signUpAndCreateWorkspace(identity, page)
  await dropScreenshot(page, { height: 900, width: 1400 })

  await openSave(page)
  await page.getByRole('button', { name: /Batch export/ }).click()
  const batch = page.getByRole('dialog', { name: 'Batch export' })
  await expect(batch).toBeVisible()

  // A file that is not an image is refused with a reason; the screenshots are imported.
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.items.add(new File(['not an image'], 'notes.txt', { type: 'text/plain' }))
    document
      .querySelector('[data-batch-dropzone]')!
      .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
  })
  const notAdded = batch.getByRole('alert').filter({ hasText: 'not added' })
  await expect(notAdded).toContainText(/notes\.txt: File type not supported/)
  await notAdded.getByRole('button', { name: 'Dismiss' }).click()
  await expect(notAdded).toBeHidden()
  const shots = [
    { height: 900, width: 1400 },
    { height: 1600, width: 900 },
    { height: 1200, width: 1200 },
  ]
  await dropIntoBatch(page, shots)
  const cards = batch.getByRole('list', { name: 'Batch screenshots' }).getByRole('listitem')
  await expect(cards).toHaveCount(3)
  await expect(cards.nth(1)).toContainText('900×1600')
  // Each card is previewed by the stage, with the design applied.
  await expect(cards.first().locator('img')).toBeVisible({ timeout: 60_000 })

  // Two sizes: the design's own canvas and an Instagram square.
  await batch.getByRole('button', { name: 'Add sizes' }).click()
  await page.getByRole('checkbox', { name: /Instagram square/ }).click()
  await page.keyboard.press('Escape')
  await expect(batch.getByText('3 screenshots × 2 sizes → 6 files')).toBeVisible()

  // Cancelling stops the run without a download; nothing is left half-rendered. Both
  // clicks happen in the page, so the cancel lands while the first render (always
  // well over 50ms: the stage settles and captures) is still running.
  let downloads = 0
  page.on('download', () => downloads++)
  await page.evaluate(async () => {
    const dialog = document.querySelector('[role="dialog"]')!
    const button = (label: string) =>
      [...dialog.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === label
      )!
    button('Export 3 as ZIP').click()
    await new Promise((resolve) => setTimeout(resolve, 50))
    button('Cancel').click()
  })
  await expect(page.getByText('Batch cancelled')).toBeVisible()
  await expect(cards.filter({ hasText: 'Rendering' })).toHaveCount(0)
  expect(downloads).toBe(0)

  const download = page.waitForEvent('download', { timeout: 180_000 })
  await batch.getByRole('button', { name: /^Export 3 as ZIP$/ }).click()
  expect((await download).suggestedFilename()).toBe('screenshots-batch.zip')
  const zip = await JSZip.loadAsync(await bytesOf(await download))
  const files = Object.values(zip.files)
    .filter((file) => !file.dir)
    .map((file) => file.name)
    .sort()
  expect(files).toEqual([
    '1920x1440/1-screen-1.png',
    '1920x1440/2-screen-2.png',
    '1920x1440/3-screen-3.png',
    'instagram-square-1080x1080/1-screen-1.png',
    'instagram-square-1080x1080/2-screen-2.png',
    'instagram-square-1080x1080/3-screen-3.png',
  ])
  for (const name of files) {
    const expected = name.startsWith('1920x1440/') ? CANVAS : { height: 1080, width: 1080 }
    expect(pngSize(await zip.file(name)!.async('nodebuffer')), name).toEqual(expected)
  }
  await expect(cards.filter({ hasText: 'Done' })).toHaveCount(3)
  await expect(batch.getByRole('button', { name: 'Download ZIP' })).toBeEnabled()
})

test('the editor exports PNG, JPEG, WebP, SVG, PDF, and a multi-size ZIP with exact bytes', async ({
  identity,
  page,
}) => {
  test.setTimeout(360_000)
  await signUpAndCreateWorkspace(identity, page)
  await dropScreenshot(page, { height: 900, width: 1400 })

  await openSave(page)
  await pickFormat(page, 'PNG')
  await page.getByRole('button', { name: /^1x/ }).click()
  let download = await exportDownload(page, 'Export as PNG')
  expect(download.suggestedFilename()).toBe('dashboard-1920x1440.png')
  expect(pngSize(await bytesOf(download))).toEqual(CANVAS)

  await openSave(page)
  await pickFormat(page, 'JPEG')
  download = await exportDownload(page, 'Export as JPEG')
  expect(download.suggestedFilename()).toBe('dashboard-1920x1440.jpg')
  expect(jpegSize(await bytesOf(download))).toEqual(CANVAS)

  await openSave(page)
  await pickFormat(page, 'WebP')
  await page.getByRole('switch', { name: 'Transparent background' }).click()
  download = await exportDownload(page, 'Export as WebP')
  expect(download.suggestedFilename()).toBe('dashboard-1920x1440.webp')
  const webp = await bytesOf(download)
  expect(webpSize(webp)).toEqual(CANVAS)
  // Without its background the canvas corner is see-through; the screenshot is opaque.
  const alpha = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    const at = (x: number, y: number) => context.getImageData(x, y, 1, 1).data[3]
    return { centre: at(bitmap.width / 2, bitmap.height / 2), corner: at(2, 2) }
  }, webp.toString('base64'))
  expect(alpha).toEqual({ centre: 255, corner: 0 })

  await openSave(page)
  await pickFormat(page, 'SVG')
  await page.getByRole('switch', { name: 'Transparent background' }).click()
  download = await exportDownload(page, 'Export as SVG')
  expect(download.suggestedFilename()).toBe('dashboard-1920x1440.svg')
  const svg = (await bytesOf(download)).toString('utf8')
  expect(svg).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<svg /)
  expect(svg).toContain('<foreignObject')
  expect(svg).not.toMatch(/<script/i)
  // The browser parses it as SVG and draws it at its declared size.
  const drawn = await page.evaluate(async (markup) => {
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')
    if (parsed.querySelector('parsererror')) return null
    const root = parsed.documentElement
    const image = new Image()
    image.src = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
    await image.decode()
    return {
      attributes: {
        height: Number(root.getAttribute('height')),
        width: Number(root.getAttribute('width')),
      },
      natural: { height: image.naturalHeight, width: image.naturalWidth },
    }
  }, svg)
  expect(drawn).toEqual({ attributes: CANVAS, natural: CANVAS })

  await openSave(page)
  await pickFormat(page, 'PDF')
  await page.getByRole('button', { name: 'Add sizes' }).click()
  await page.getByRole('checkbox', { name: /Instagram story/ }).click()
  await page.keyboard.press('Escape')
  download = await exportDownload(page, 'Export PDF · 2 pages')
  expect(download.suggestedFilename()).toBe('dashboard.pdf')
  expect(pdfPages(await bytesOf(download))).toEqual([CANVAS, { height: 1920, width: 1080 }])

  // The same two sizes as PNG make a ZIP, each laid out for its size.
  await openSave(page)
  await pickFormat(page, 'PNG')
  download = await exportDownload(page, 'Export 2 files (ZIP)')
  expect(download.suggestedFilename()).toBe('dashboard-sizes.zip')
  const zip = await JSZip.loadAsync(await bytesOf(download))
  expect(Object.keys(zip.files).sort()).toEqual([
    'dashboard-1920x1440.png',
    'dashboard-instagram-story-1080x1920.png',
  ])
  expect(
    pngSize(await zip.file('dashboard-instagram-story-1080x1920.png')!.async('nodebuffer'))
  ).toEqual({
    height: 1920,
    width: 1080,
  })
})

test('GIF and MP4 render the real timeline', async ({ identity, page }) => {
  test.setTimeout(480_000)
  await signUpAndCreateWorkspace(identity, page)
  await dropScreenshot(page, { height: 900, width: 1400 })

  // Add one motion preset from the Motion tab.
  await page.getByRole('button', { exact: true, name: 'Motion' }).first().click()
  await page
    .getByRole('button', { name: /Hero Landing animation/ })
    .first()
    .click()

  await openSave(page)
  await pickFormat(page, 'GIF')
  const duration = page.getByLabel('Duration (timeline)')
  await duration.fill('1')
  await duration.press('Enter')
  await page.getByRole('button', { exact: true, name: '10 fps' }).click()
  await page.getByRole('button', { exact: true, name: '480px' }).click()
  let download = await exportDownload(page, 'Export as GIF', 240_000)
  expect(download.suggestedFilename()).toBe('dashboard.gif')
  const gif = gifInfo(await bytesOf(download))
  expect({ height: gif.height, width: gif.width }).toEqual({ height: 360, width: 480 })
  // One second at 10 fps; the encoder may merge identical frames.
  expect(gif.frames).toBeGreaterThan(3)
  expect(gif.frames).toBeLessThanOrEqual(10)

  await openSave(page)
  await pickFormat(page, 'MP4')
  await page.getByRole('button', { exact: true, name: '24 fps' }).click()
  download = await exportDownload(page, 'Export as MP4', 240_000)
  expect(download.suggestedFilename()).toBe('dashboard.mp4')
  const mp4 = mp4Info(await bytesOf(download))
  expect({ height: mp4.height, width: mp4.width }).toEqual(CANVAS)
  expect(mp4.samples).toBe(24)
  expect(mp4.seconds).toBeGreaterThan(0.9)
  expect(mp4.seconds).toBeLessThan(1.1)
})
