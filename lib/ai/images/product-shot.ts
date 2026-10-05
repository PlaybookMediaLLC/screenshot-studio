import path from 'node:path'
import sharp from 'sharp'
import { getMockupDefinition } from '@/lib/constants/mockups'

/**
 * Server-side product shots: a screenshot inside a real device frame on a
 * gradient, with an optional headline. Uses the editor's own mockup frames,
 * screen rectangles, and screen masks, so a generated shot matches what a
 * user would compose by hand and can be opened in the editor for a second
 * pass.
 *
 * Only front-facing frames are offered: their screens are axis-aligned
 * rectangles, which a straight resize fills exactly. Perspective frames need
 * a projective warp the browser editor does with CSS.
 */

export const productShotMockups = [
  'iphone-17-pro-front',
  'iphone-17-front',
  'macbook-pro-14-front',
  'macbook-pro-16-front',
  'macbook-neo-front',
  'macbook-pro-studio-front',
] as const

export type ProductShotMockup = (typeof productShotMockups)[number]

export const productShotFormats = {
  landscape: { height: 900, width: 1600 },
  portrait: { height: 1350, width: 1080 },
  square: { height: 1080, width: 1080 },
  story: { height: 1920, width: 1080 },
} as const

export type ProductShotFormat = keyof typeof productShotFormats

export type ProductShotInput = {
  background: { from: string; to: string }
  format: ProductShotFormat
  headline?: string
  mockupId: ProductShotMockup
  screenshot: Uint8Array
  subheadline?: string
  textColor?: string
}

const hexColor = /^#[0-9a-f]{6}$/i
const fontDirectory = path.join(process.cwd(), 'public', 'fonts')
const publicDirectory = path.join(process.cwd(), 'public')

function escapeMarkup(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function requireHex(value: string, field: string): string {
  if (!hexColor.test(value)) throw new Error(`${field} must be a #rrggbb color.`)
  return value
}

/** The device with the screenshot masked into its screen, at native frame size. */
async function renderDevice(mockupId: ProductShotMockup, screenshot: Uint8Array) {
  const asset = getMockupDefinition(mockupId)?.asset
  if (!asset) throw new Error(`Unknown mockup ${mockupId}.`)
  const framePath = path.join(publicDirectory, asset.src)
  const frame = await sharp(framePath).metadata()
  const frameWidth = frame.width ?? 0
  const frameHeight = frame.height ?? 0
  const screen = asset.maskScreen ?? asset.screen
  const left = Math.round(screen.x * frameWidth)
  const top = Math.round(screen.y * frameHeight)
  const width = Math.round(screen.width * frameWidth)
  const height = Math.round(screen.height * frameHeight)

  let content = sharp(screenshot).resize(width, height, { fit: 'cover', position: 'top' })
  if (asset.maskSrc) {
    const mask = await sharp(path.join(publicDirectory, asset.maskSrc))
      .resize(width, height, { fit: 'fill' })
      .toBuffer()
    content = sharp(await content.png().toBuffer()).composite([{ blend: 'dest-in', input: mask }])
  }

  return sharp({
    create: {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      channels: 4,
      height: frameHeight,
      width: frameWidth,
    },
  })
    .composite([
      { input: await content.png().toBuffer(), left, top },
      { input: framePath, left: 0, top: 0 },
    ])
    .png()
    .toBuffer()
}

async function renderText(
  text: string,
  options: { color: string; file: string; font: string; width: number }
) {
  return sharp({
    text: {
      align: 'centre',
      font: options.font,
      fontfile: path.join(fontDirectory, options.file),
      rgba: true,
      text: `<span foreground="${options.color}">${escapeMarkup(text)}</span>`,
      width: options.width,
      wrap: 'word',
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true })
}

/**
 * True when an image is nearly one flat color. Pages that animate their
 * content in after load often capture as an empty frame; callers use this to
 * reject the capture instead of shipping a blank product shot.
 */
export async function isNearlyBlank(image: Uint8Array): Promise<boolean> {
  const { channels } = await sharp(image).stats()
  return channels.slice(0, 3).every((channel) => channel.stdev < 12)
}

export async function composeProductShot(
  input: ProductShotInput
): Promise<{ height: number; png: Buffer; width: number }> {
  const { height, width } = productShotFormats[input.format]
  const from = requireHex(input.background.from, 'background.from')
  const to = requireHex(input.background.to, 'background.to')
  const textColor = requireHex(input.textColor ?? '#ffffff', 'textColor')
  const margin = Math.round(Math.min(width, height) * 0.07)
  const textWidth = width - margin * 2

  const layers: sharp.OverlayOptions[] = []
  let textBottom = margin
  if (input.headline) {
    const headline = await renderText(input.headline, {
      color: textColor,
      file: 'SFPRODISPLAYBOLD.OTF',
      font: `SF Pro Display Bold ${Math.round(width * 0.052)}`,
      width: textWidth,
    })
    layers.push({
      input: headline.data,
      left: Math.round((width - headline.info.width) / 2),
      top: textBottom,
    })
    textBottom += headline.info.height + Math.round(margin * 0.35)
    if (input.subheadline) {
      const subheadline = await renderText(input.subheadline, {
        color: textColor,
        file: 'SFPRODISPLAYREGULAR.OTF',
        font: `SF Pro Display ${Math.round(width * 0.026)}`,
        width: textWidth,
      })
      layers.push({
        input: subheadline.data,
        left: Math.round((width - subheadline.info.width) / 2),
        top: textBottom,
      })
      textBottom += subheadline.info.height
    }
    textBottom += margin
  }

  // Fit the device into the space left under the copy.
  const device = await renderDevice(input.mockupId, input.screenshot)
  const deviceMeta = await sharp(device).metadata()
  const boxWidth = width - margin * 2
  const boxHeight = height - textBottom - margin
  const scale = Math.min(boxWidth / (deviceMeta.width ?? 1), boxHeight / (deviceMeta.height ?? 1))
  const deviceWidth = Math.max(1, Math.round((deviceMeta.width ?? 1) * scale))
  const deviceHeight = Math.max(1, Math.round((deviceMeta.height ?? 1) * scale))
  const sizedDevice = await sharp(device).resize(deviceWidth, deviceHeight).png().toBuffer()
  const deviceLeft = Math.round((width - deviceWidth) / 2)
  const deviceTop = textBottom + Math.round((boxHeight - deviceHeight) / 2)
  // The shadow follows the device outline: black with the device's own alpha,
  // softened and faded. The canvas is padded first so the blur is not clipped
  // into a hard rectangle at the device's bounds.
  // Padding never exceeds the margin, so the shadow always fits the canvas
  // even when the device fills the whole box.
  const pad = Math.floor(margin)
  const blur = Math.max(1, Math.floor(pad / 3))
  const shadowAlpha = await sharp(await sharp(sizedDevice).extractChannel('alpha').toBuffer())
    .extend({ background: { b: 0, g: 0, r: 0 }, bottom: pad, left: pad, right: pad, top: pad })
    .linear(0.4, 0)
    .blur(blur)
    .toBuffer()
  const shadow = await sharp({
    create: {
      background: { b: 0, g: 0, r: 0 },
      channels: 3,
      height: deviceHeight + pad * 2,
      width: deviceWidth + pad * 2,
    },
  })
    .joinChannel(shadowAlpha)
    .png()
    .toBuffer()

  const background = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
      `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`
  )
  const png = await sharp(background)
    .composite([
      ...layers,
      { input: shadow, left: deviceLeft - pad, top: deviceTop - pad + Math.round(margin * 0.3) },
      { input: sizedDevice, left: deviceLeft, top: deviceTop },
    ])
    .png()
    .toBuffer()
  return { height, png, width }
}
