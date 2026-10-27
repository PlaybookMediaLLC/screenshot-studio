import { chooseOption } from './framework/browser'
import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { signUpAndCreateWorkspace } from './framework/auth'
import { decodeMp4, readMp4Tracks } from './framework/mp4'
import { configureE2EFlow, expect, test } from './framework/flow'

configureE2EFlow()

const TONE = 'test/e2e/fixtures/tone.wav'

/** Paste a tall screenshot (16 coloured, labelled bands) as the main image. */
async function pasteLongScreenshot(page: Page) {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 3200
    const context = canvas.getContext('2d')!
    for (let band = 0; band < 16; band++) {
      context.fillStyle = `hsl(${band * 22}, 70%, 55%)`
      context.fillRect(0, band * 200, 800, 200)
      context.fillStyle = '#ffffff'
      context.font = 'bold 64px sans-serif'
      context.fillText(`Section ${band + 1}`, 40, band * 200 + 120)
    }
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((png) => resolve(png!)))
    const data = new DataTransfer()
    data.items.add(new File([blob], 'long-page.png', { type: 'image/png' }))
    document.body.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })
    )
  })
  await expect(page.locator('img[alt="Main image"]')).toHaveCount(1)
}

test('an animated product screenshot exports as an MP4 with its audio and captions', async ({
  identity,
  page,
}) => {
  // Capturing every frame is slow on a loaded machine; the budget allows for it.
  test.setTimeout(900_000)
  await signUpAndCreateWorkspace(identity, page)
  await pasteLongScreenshot(page)
  // A plain background keeps each captured frame quick.
  await page.getByRole('button', { exact: true, name: 'BG' }).click()
  await page.getByRole('button', { exact: true, name: 'Transparent' }).click()

  // A browser-framed screenshot, with the timeline open.
  await page.getByRole('button', { exact: true, name: 'Frame' }).click()
  await page.getByRole('button', { name: 'Browser frame' }).click()
  await page.getByRole('button', { exact: true, name: 'Animate' }).click()
  const timelineRows = page.locator('[data-motion-tracks]')
  await expect(timelineRows).toBeAttached()

  // Keyframes through the panel: scale the screenshot from 100% to 125%.
  await page.locator('img[alt="Main image"]').click({ position: { x: 20, y: 40 } })
  await page.getByRole('button', { exact: true, name: 'Motion' }).click()
  await page.getByRole('button', { name: 'Add Scale keyframe' }).click()
  await expect(page.locator('[data-keyframe]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Duplicate' }).click()
  await expect(page.locator('[data-keyframe]')).toHaveCount(2)
  await page.getByLabel('Value', { exact: true }).fill('125')
  await page.getByLabel('Time', { exact: true }).fill('1.5')
  await expect(page.getByRole('button', { name: 'Keyframe at 1.50 seconds' })).toBeVisible()

  // Move it on the timeline by dragging, then nudge it with the keyboard.
  const keyframe = page.getByRole('button', { name: 'Keyframe at 1.50 seconds' })
  const box = (await keyframe.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2, { steps: 6 })
  await page.mouse.up()
  const moved = page.locator('[data-keyframe][aria-pressed="true"]')
  const movedTime = Number((await moved.getAttribute('aria-label'))!.match(/[\d.]+/)![0])
  expect(movedTime).toBeLessThan(1.5)
  expect(movedTime).toBeGreaterThan(0.5)
  await moved.press('ArrowRight')
  await expect(moved).toHaveAttribute(
    'aria-label',
    `Keyframe at ${(movedTime + 0.01).toFixed(2)} seconds`
  )

  // A custom curve: drag a Bézier control point and type another.
  await chooseOption(page.getByLabel('Easing into this keyframe', { exact: true }), 'Custom curve')
  await expect(page.getByRole('button', { name: 'Add Rotation keyframe' })).toBeVisible()
  await page.getByLabel('Easing into this keyframe', { exact: true }).press('Delete')
  await expect(page.locator('[data-keyframe]')).toHaveCount(2)
  const handle = page.locator('[data-bezier-handle="1"]')
  const point = (await handle.boundingBox())!
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2)
  await page.mouse.down()
  await page.mouse.move(point.x + 30, point.y - 40, { steps: 4 })
  await page.mouse.up()
  await page.getByLabel('Bézier x2').fill('0.3')
  await expect(page.locator('[data-bezier-editor]')).toHaveAttribute(
    'aria-label',
    /cubic-bezier\([\d.]+, [\d.]+, 0\.3, /
  )

  // A second track on the same layer, deleted again from the keyboard.
  await page.getByRole('button', { name: 'Add Rotation keyframe' }).click()
  await expect(page.locator('[data-keyframe]')).toHaveCount(3)
  await page.locator('[data-keyframe][aria-pressed="true"]').press('Delete')
  await expect(page.locator('[data-keyframe]')).toHaveCount(2)

  // Scroll the long screenshot through its browser frame, from the start.
  await page.getByRole('button', { name: 'Keyframe at 0.00 seconds' }).click()
  await page.getByLabel('Scroll the screenshot in its frame').click()
  await page.getByLabel('Duration', { exact: true }).fill('2.5')
  await page.getByRole('button', { name: 'Add pause' }).click()
  await expect(page.locator('[data-timeline-span="scroll"]')).toBeVisible()

  // A typewriter headline.
  await page.getByRole('button', { exact: true, name: 'Design' }).click()
  await page.getByRole('button', { name: 'Add Text' }).click()
  await page.getByRole('button', { exact: true, name: 'Motion' }).click()
  await page.getByRole('button', { exact: true, name: 'Typewriter' }).click()
  await expect(page.locator('[data-timeline-span="text"]')).toBeVisible()

  // A zoom callout whose magnification is keyframed like any property.
  await page.getByRole('button', { exact: true, name: 'Design' }).click()
  await page.getByRole('button', { name: 'Zoom callout' }).click()
  await page.getByRole('button', { exact: true, name: 'Motion' }).click()
  await page.getByRole('button', { name: 'Add Zoom keyframe' }).click()
  await expect(page.locator('[data-keyframe]')).toHaveCount(3)

  // Audio, placed at half a second.
  await page.locator('[data-audio-input]').setInputFiles(TONE)
  await expect(page.locator('[data-audio-clip]')).toHaveCount(1)
  await page.getByLabel('Start on timeline').fill('0.5')
  await expect(page.locator('[data-timeline-span="audio"]')).toBeVisible()

  // A caption burned into the video.
  await page.getByRole('button', { name: 'Add caption at playhead' }).click()
  await page.getByLabel('Caption text').fill('Scroll through the release')
  await expect(page.locator('[data-timeline-span="caption"]')).toBeVisible()
  // The stage draws the caption at the playhead, where it was added.
  await expect(page.locator('[data-caption-id]')).toHaveText('Scroll through the release')

  // Export a small MP4 of the whole timeline.
  await page.getByRole('button', { name: 'Export Video' }).click()
  const dialog = page.getByRole('dialog')
  const expected = Number(
    (await dialog.getByText(/^\d+\.\d seconds$/).textContent())!.replace(' seconds', '')
  )
  await dialog.getByRole('button', { name: /^Low/ }).click()
  const download = page.waitForEvent('download', { timeout: 840_000 })
  await dialog.getByRole('button', { name: 'Export as MP4' }).click()
  const file = await readFile((await (await download).path())!)

  const tracks = readMp4Tracks(file)
  const video = tracks.find((track) => track.handler === 'vide')
  const sound = tracks.find((track) => track.handler === 'soun')
  expect(video?.codec).toBe('avc1')
  expect(sound?.codec, 'the MP4 has an AAC audio track').toBe('mp4a')
  expect(Math.abs(video!.duration - expected)).toBeLessThan(0.05)
  expect(video!.samples.length).toBe(Math.ceil(expected * 60))
  expect(Math.abs(sound!.duration - expected)).toBeLessThan(0.1)

  // Decode it in the browser: frames change over time and the tone is where it was placed.
  const decoded = await decodeMp4(page, file, video!)
  expect(decoded.decodedFrames, 'every frame decodes').toBe(video!.samples.length)
  expect(decoded.firstToMiddle, 'frames change as the animation plays').toBeGreaterThan(2)
  expect(decoded.middleToLast).toBeGreaterThan(2)
  expect(decoded.during, 'the tone plays from its start').toBeGreaterThan(0.05)
  expect(decoded.before, 'nothing plays before the clip starts').toBeLessThan(0.01)
  expect(Math.abs(decoded.audioDuration - expected)).toBeLessThan(0.1)
})
