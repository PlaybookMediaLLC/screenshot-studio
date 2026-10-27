import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { composeProductShot, isNearlyBlank } from '@/lib/ai/images/product-shot'
import { resolveModelIds } from '@/lib/ai/models/env'
import { toOpenRouterModelId } from '@/lib/ai/models/provider'

async function solid(width: number, height: number, color: { r: number; g: number; b: number }) {
  return sharp({ create: { background: color, channels: 3, height, width } })
    .png()
    .toBuffer()
}

async function pixel(image: Buffer, x: number, y: number) {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true })
  const offset = (y * info.width + x) * info.channels
  return [...data.subarray(offset, offset + 3)]
}

test('product shots place the screenshot inside the device screen on the requested canvas', async () => {
  const screenshot = await solid(1920, 1080, { b: 0, g: 200, r: 0 })
  const shot = await composeProductShot({
    background: { from: '#ff0000', to: '#ff0000' },
    format: 'landscape',
    mockupId: 'macbook-pro-14-front',
    screenshot,
  })
  const meta = await sharp(shot.png).metadata()
  assert.deepEqual([meta.width, meta.height], [1600, 900])
  // Centre of the canvas is the laptop screen: the screenshot's green.
  const [r, g] = await pixel(shot.png, 800, 420)
  assert.ok(g > 150 && r < 60, `expected screenshot green at centre, got ${[r, g]}`)
  // Top-left corner is background.
  const [cornerR, cornerG] = await pixel(shot.png, 5, 5)
  assert.ok(cornerR > 200 && cornerG < 60, 'expected background red at the corner')
})

test('product shots render headline space and reject invalid colors', async () => {
  const screenshot = await solid(375, 667, { b: 255, g: 255, r: 255 })
  const shot = await composeProductShot({
    background: { from: '#111827', to: '#1f2937' },
    format: 'portrait',
    headline: 'Invoices that send themselves',
    mockupId: 'iphone-17-pro-front',
    screenshot,
  })
  assert.deepEqual([shot.width, shot.height], [1080, 1350])
  await assert.rejects(
    composeProductShot({
      background: { from: 'red', to: '#000000' },
      format: 'square',
      mockupId: 'iphone-17-front',
      screenshot,
    }),
    /background.from/
  )
})

test('blank captures are detected so they never become product shots', async () => {
  assert.equal(await isNearlyBlank(await solid(400, 300, { b: 10, g: 10, r: 10 })), true)
  const busy = await sharp({
    create: { background: { b: 255, g: 255, r: 255 }, channels: 3, height: 300, width: 400 },
  })
    .composite([{ input: await solid(200, 300, { b: 0, g: 0, r: 0 }), left: 0, top: 0 }])
    .png()
    .toBuffer()
  assert.equal(await isNearlyBlank(busy), false)
})

test('model roles resolve to OpenRouter ids with per-role overrides', () => {
  const ids = resolveModelIds({ PLATFORM_AI_MODEL_DEEP: 'anthropic/claude-sonnet-4.5' })
  assert.equal(ids.deep, 'anthropic/claude-sonnet-4.5')
  assert.equal(toOpenRouterModelId('gpt-4o-mini'), 'openai/gpt-4o-mini')
  assert.match(ids.fast, /^[a-z-]+\//)
  assert.equal(toOpenRouterModelId(ids.deep), 'anthropic/claude-sonnet-4.5')
  assert.equal(resolveModelIds({ PLATFORM_AI_MODEL_DEEP: '  ' }).deep, resolveModelIds({}).deep)
})
