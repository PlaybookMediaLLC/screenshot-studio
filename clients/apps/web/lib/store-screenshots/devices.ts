import { z } from 'zod'
import { getMockupDefinition } from '@/lib/constants/mockups'
import type { MockupDefinition } from '@/types/mockup'
import type { DeviceFrame, DeviceStyle } from './document/schema'

/**
 * The device catalog for store screenshots.
 *
 * Frames are original artwork: a photographed frame from the shared mockup
 * library where one exists for the chosen finish, otherwise a procedural
 * frame drawn from the geometry below. Geometry is in portrait orientation
 * and relative units, so the same entry renders at any size and rotates to
 * landscape without a second asset. Finish names follow the manufacturer's
 * marketing names; colors are approximations, not color-managed samples.
 */

/** Device families. */
export const deviceFamilySchema = z.enum(['phone', 'tablet', 'laptop', 'watch', 'headset'])

/** Operating system a device runs; selects status bar artwork. */
export const devicePlatformSchema = z.enum(['ios', 'android', 'macos', 'watchos', 'visionos'])

/** Front camera cutouts drawn on procedural frames. */
export const cutoutSchema = z.enum(['dynamic-island', 'punch-hole', 'notch', 'none'])

/** Device family. */
export type DeviceFamily = z.infer<typeof deviceFamilySchema>
/** Device platform. */
export type DevicePlatform = z.infer<typeof devicePlatformSchema>
/** Camera cutout. */
export type Cutout = z.infer<typeof cutoutSchema>

/** One color finish of a device. */
export type DeviceFinish = {
  id: string
  name: string
  /** Body color. */
  body: string
  /** Edge/band color, slightly darker or lighter than the body. */
  edge: string
}

/** A catalog entry. */
export type DeviceModel = {
  id: string
  name: string
  family: DeviceFamily
  platform: DevicePlatform
  /** Screen width / height in portrait, from the native resolution. */
  screenAspect: number
  /** Bezel thickness as a fraction of the body width. */
  bezel: number
  /** Body corner radius as a fraction of the body width. */
  bodyRadius: number
  /** Screen corner radius as a fraction of the screen width. */
  screenRadius: number
  cutout: Cutout
  finishes: DeviceFinish[]
  /** Photographed frame from the shared mockup library and the finish it shows. */
  photo?: { mockupId: string; finishId: string }
  supportsLandscape: boolean
  /** Whether a status bar can be drawn on this device's screen. */
  statusBar: boolean
}

const phoneFinishes = {
  pro: [
    { id: 'deep-blue', name: 'Deep Blue', body: '#3A4255', edge: '#2A3040' },
    { id: 'cosmic-orange', name: 'Cosmic Orange', body: '#E07B39', edge: '#B85E25' },
    { id: 'silver', name: 'Silver', body: '#DCDDE0', edge: '#B9BBC0' },
  ],
  base: [
    { id: 'black', name: 'Black', body: '#3A3A3C', edge: '#232325' },
    { id: 'white', name: 'White', body: '#F2F2F0', edge: '#D5D5D2' },
    { id: 'mist-blue', name: 'Mist Blue', body: '#A9BED3', edge: '#8AA0B6' },
    { id: 'sage', name: 'Sage', body: '#B5C2A5', edge: '#96A386' },
    { id: 'lavender', name: 'Lavender', body: '#C9B8DD', edge: '#A998BE' },
  ],
  air: [
    { id: 'space-black', name: 'Space Black', body: '#2E2E30', edge: '#1C1C1E' },
    { id: 'cloud-white', name: 'Cloud White', body: '#F4F3EE', edge: '#D8D7D1' },
    { id: 'light-gold', name: 'Light Gold', body: '#E9D9B8', edge: '#CDBB97' },
    { id: 'sky-blue', name: 'Sky Blue', body: '#C6D9E8', edge: '#A6BBCB' },
  ],
} satisfies Record<string, DeviceFinish[]>

/** Every catalog device, in picker order. */
export const DEVICE_MODELS: DeviceModel[] = [
  {
    id: 'iphone-17-pro',
    name: 'iPhone 17 Pro',
    family: 'phone',
    platform: 'ios',
    screenAspect: 1206 / 2622,
    bezel: 0.042,
    bodyRadius: 0.2,
    screenRadius: 0.165,
    cutout: 'dynamic-island',
    finishes: phoneFinishes.pro,
    photo: { mockupId: 'iphone-17-pro-front', finishId: 'deep-blue' },
    supportsLandscape: true,
    statusBar: true,
  },
  {
    id: 'iphone-17-pro-max',
    name: 'iPhone 17 Pro Max',
    family: 'phone',
    platform: 'ios',
    screenAspect: 1320 / 2868,
    bezel: 0.04,
    bodyRadius: 0.19,
    screenRadius: 0.16,
    cutout: 'dynamic-island',
    finishes: phoneFinishes.pro,
    supportsLandscape: true,
    statusBar: true,
  },
  {
    id: 'iphone-17',
    name: 'iPhone 17',
    family: 'phone',
    platform: 'ios',
    screenAspect: 1206 / 2622,
    bezel: 0.042,
    bodyRadius: 0.2,
    screenRadius: 0.165,
    cutout: 'dynamic-island',
    finishes: phoneFinishes.base,
    photo: { mockupId: 'iphone-17-front', finishId: 'black' },
    supportsLandscape: true,
    statusBar: true,
  },
  {
    id: 'iphone-air',
    name: 'iPhone Air',
    family: 'phone',
    platform: 'ios',
    screenAspect: 1260 / 2736,
    bezel: 0.036,
    bodyRadius: 0.19,
    screenRadius: 0.16,
    cutout: 'dynamic-island',
    finishes: phoneFinishes.air,
    supportsLandscape: true,
    statusBar: true,
  },
  {
    id: 'ipad-pro-13',
    name: 'iPad Pro 13-inch',
    family: 'tablet',
    platform: 'ios',
    screenAspect: 2064 / 2752,
    bezel: 0.035,
    bodyRadius: 0.06,
    screenRadius: 0.045,
    cutout: 'none',
    finishes: [
      { id: 'space-black', name: 'Space Black', body: '#2F2F31', edge: '#1D1D1F' },
      { id: 'silver', name: 'Silver', body: '#E3E4E6', edge: '#C4C5C8' },
    ],
    supportsLandscape: true,
    statusBar: true,
  },
  {
    id: 'ipad-air-11',
    name: 'iPad Air 11-inch',
    family: 'tablet',
    platform: 'ios',
    screenAspect: 1640 / 2360,
    bezel: 0.045,
    bodyRadius: 0.07,
    screenRadius: 0.05,
    cutout: 'none',
    finishes: [
      { id: 'space-gray', name: 'Space Gray', body: '#4A4B4F', edge: '#333438' },
      { id: 'blue', name: 'Blue', body: '#A7B9CF', edge: '#8899AE' },
      { id: 'purple', name: 'Purple', body: '#C2B5D6', edge: '#A295B6' },
      { id: 'starlight', name: 'Starlight', body: '#ECE5D8', edge: '#CFC7B8' },
    ],
    supportsLandscape: true,
    statusBar: true,
  },
  {
    id: 'pixel-10-pro',
    name: 'Pixel 10 Pro',
    family: 'phone',
    platform: 'android',
    screenAspect: 1280 / 2856,
    bezel: 0.04,
    bodyRadius: 0.16,
    screenRadius: 0.12,
    cutout: 'punch-hole',
    finishes: [
      { id: 'obsidian', name: 'Obsidian', body: '#2B2C2E', edge: '#1A1B1D' },
      { id: 'porcelain', name: 'Porcelain', body: '#EFEBE3', edge: '#D1CCC2' },
      { id: 'moonstone', name: 'Moonstone', body: '#8A939E', edge: '#6C747E' },
      { id: 'jade', name: 'Jade', body: '#C7DCCB', edge: '#A8BDAC' },
    ],
    supportsLandscape: true,
    statusBar: true,
  },
  {
    id: 'galaxy-s25-ultra',
    name: 'Galaxy S25 Ultra',
    family: 'phone',
    platform: 'android',
    screenAspect: 1440 / 3120,
    bezel: 0.032,
    bodyRadius: 0.07,
    screenRadius: 0.05,
    cutout: 'punch-hole',
    finishes: [
      { id: 'titanium-silverblue', name: 'Titanium Silverblue', body: '#9AA6B4', edge: '#7B8795' },
      { id: 'titanium-black', name: 'Titanium Black', body: '#2D2E30', edge: '#1B1C1E' },
      { id: 'titanium-gray', name: 'Titanium Gray', body: '#8C8B88', edge: '#6E6D6A' },
      { id: 'titanium-whitesilver', name: 'Titanium Whitesilver', body: '#E4E4E2', edge: '#C6C6C4' },
    ],
    supportsLandscape: true,
    statusBar: true,
  },
  {
    id: 'macbook-pro-14',
    name: 'MacBook Pro 14-inch',
    family: 'laptop',
    platform: 'macos',
    screenAspect: 3024 / 1964,
    bezel: 0.02,
    bodyRadius: 0.02,
    screenRadius: 0.01,
    cutout: 'notch',
    finishes: [
      { id: 'space-black', name: 'Space Black', body: '#2E2F31', edge: '#1C1D1F' },
      { id: 'silver', name: 'Silver', body: '#D9DADC', edge: '#B8B9BC' },
    ],
    photo: { mockupId: 'macbook-pro-14-front', finishId: 'space-black' },
    supportsLandscape: false,
    statusBar: false,
  },
  {
    id: 'macbook-air-15',
    name: 'MacBook Air 15-inch',
    family: 'laptop',
    platform: 'macos',
    screenAspect: 2880 / 1864,
    bezel: 0.02,
    bodyRadius: 0.02,
    screenRadius: 0.01,
    cutout: 'notch',
    finishes: [
      { id: 'midnight', name: 'Midnight', body: '#2E3440', edge: '#1D222B' },
      { id: 'starlight', name: 'Starlight', body: '#E8E1D4', edge: '#CBC3B4' },
      { id: 'sky-blue', name: 'Sky Blue', body: '#C3D3E0', edge: '#A3B4C2' },
    ],
    supportsLandscape: false,
    statusBar: false,
  },
  {
    id: 'apple-watch-ultra',
    name: 'Apple Watch Ultra',
    family: 'watch',
    platform: 'watchos',
    screenAspect: 422 / 514,
    bezel: 0.08,
    bodyRadius: 0.3,
    screenRadius: 0.22,
    cutout: 'none',
    finishes: [
      { id: 'natural', name: 'Natural Titanium', body: '#C9C4BA', edge: '#A8A398' },
      { id: 'black', name: 'Black Titanium', body: '#2D2D2F', edge: '#1B1B1D' },
    ],
    photo: { mockupId: 'apple-watch-ultra-trail-loop', finishId: 'natural' },
    supportsLandscape: false,
    statusBar: false,
  },
  {
    id: 'apple-watch-series',
    name: 'Apple Watch Series',
    family: 'watch',
    platform: 'watchos',
    screenAspect: 416 / 496,
    bezel: 0.07,
    bodyRadius: 0.32,
    screenRadius: 0.24,
    cutout: 'none',
    finishes: [
      { id: 'jet-black', name: 'Jet Black', body: '#1F1F21', edge: '#121214' },
      { id: 'silver', name: 'Silver', body: '#D8D8DA', edge: '#B9B9BC' },
      { id: 'rose-gold', name: 'Rose Gold', body: '#E6C7BB', edge: '#C8A89B' },
    ],
    photo: { mockupId: 'apple-watch-midnight-pride-sport-loop', finishId: 'jet-black' },
    supportsLandscape: false,
    statusBar: false,
  },
  {
    id: 'vision-pro-window',
    name: 'Apple Vision Pro window',
    family: 'headset',
    platform: 'visionos',
    screenAspect: 1920 / 1080,
    bezel: 0.018,
    bodyRadius: 0.05,
    screenRadius: 0.04,
    cutout: 'none',
    finishes: [{ id: 'glass', name: 'Glass', body: '#FFFFFF', edge: '#FFFFFF' }],
    supportsLandscape: false,
    statusBar: false,
  },
]

const MODEL_BY_ID = new Map(DEVICE_MODELS.map((model) => [model.id, model]))

/** The model used when a document names one this build does not know. */
export const DEFAULT_DEVICE_MODEL_ID = 'iphone-17-pro'

/** Look up a model, falling back to the default so old documents keep rendering. */
export function getDeviceModel(id: string): DeviceModel {
  return MODEL_BY_ID.get(id) ?? MODEL_BY_ID.get(DEFAULT_DEVICE_MODEL_ID)!
}

/** Look up a finish on a model, falling back to its first finish. */
export function getDeviceFinish(model: DeviceModel, finishId: string): DeviceFinish {
  return model.finishes.find((finish) => finish.id === finishId) ?? model.finishes[0]
}

/** The default frame for new devices. */
export function defaultDeviceFrame(): DeviceFrame {
  return {
    modelId: DEFAULT_DEVICE_MODEL_ID,
    finishId: 'deep-blue',
    style: 'realistic',
    orientation: 'portrait',
  }
}

/**
 * The photographed frame to draw, when the frame is realistic, portrait, and
 * the finish matches the photo. Everything else uses the procedural frame.
 */
export function photoFrameFor(frame: DeviceFrame): MockupDefinition | null {
  if (frame.style !== 'realistic' || frame.orientation !== 'portrait') return null
  const model = getDeviceModel(frame.modelId)
  if (!model.photo || model.photo.finishId !== frame.finishId) return null
  return getMockupDefinition(model.photo.mockupId) ?? null
}

/** A rectangle inside the frame box, as fractions of the box. */
export type FramePart = { x: number; y: number; width: number; height: number }

/** Screen rectangle inside the frame box, as fractions of the box. */
export type ScreenRect = FramePart

/** Parts of a procedurally drawn frame, as fractions of the box. */
export type ProceduralParts = {
  body: FramePart
  /** Laptop keyboard deck. */
  base: FramePart | null
  /** Watch straps above and below the case. */
  bands: FramePart[]
  /** Watch crown. */
  crown: FramePart | null
  /** visionOS window grabber. */
  grabber: FramePart | null
}

/** Geometry needed to lay out and draw a device. */
export type DeviceGeometry = {
  /** Frame width / height as drawn (after orientation). */
  aspect: number
  screen: ScreenRect
  /** Screen corner radius as a fraction of the screen's shorter side. */
  screenRadius: number
  /** Body corner radius as a fraction of the body's shorter side. */
  bodyRadius: number
  landscape: boolean
  /** Procedural parts; null when a photographed frame or no frame is drawn. */
  parts: ProceduralParts | null
}

function normalize(parts: { width: number; height: number }, rect: FramePart): FramePart {
  return { x: rect.x / parts.width, y: rect.y / parts.height, width: rect.width / parts.width, height: rect.height / parts.height }
}

/**
 * Procedural frame layout in absolute units (box width = 1 before
 * normalizing). Phones and tablets are a body with an even bezel; laptops add
 * a keyboard deck; watches add straps and a crown; the visionOS window adds
 * its grabber bar.
 */
function proceduralGeometry(model: DeviceModel, landscape: boolean, frameless: boolean): DeviceGeometry {
  const bezel = frameless ? 0 : model.bezel
  const empty = { base: null, bands: [], crown: null, grabber: null }
  if (model.family === 'laptop' && !frameless) {
    const lidWidth = 0.86
    const lidX = (1 - lidWidth) / 2
    const side = 0.018
    const chin = 0.03
    const screenWidth = lidWidth - side * 2
    const screenHeight = screenWidth / model.screenAspect
    const lidHeight = side + screenHeight + chin
    const baseHeight = 0.045
    const box = { width: 1, height: lidHeight + baseHeight }
    return {
      aspect: box.width / box.height,
      screen: normalize(box, { x: lidX + side, y: side, width: screenWidth, height: screenHeight }),
      screenRadius: model.screenRadius,
      bodyRadius: model.bodyRadius,
      landscape: false,
      parts: {
        ...empty,
        body: normalize(box, { x: lidX, y: 0, width: lidWidth, height: lidHeight }),
        base: normalize(box, { x: 0, y: lidHeight, width: 1, height: baseHeight }),
      },
    }
  }
  if (model.family === 'watch' && !frameless) {
    const bodyWidth = 0.86
    const screenWidth = bodyWidth - bezel * 2
    const screenHeight = screenWidth / model.screenAspect
    const bodyHeight = screenHeight + bezel * 2
    const band = bodyHeight * 0.38
    const box = { width: 1, height: bodyHeight + band * 2 }
    const bandWidth = bodyWidth * 0.72
    const bandX = (bodyWidth - bandWidth) / 2
    return {
      aspect: box.width / box.height,
      screen: normalize(box, { x: bezel, y: band + bezel, width: screenWidth, height: screenHeight }),
      screenRadius: model.screenRadius,
      bodyRadius: model.bodyRadius,
      landscape: false,
      parts: {
        ...empty,
        body: normalize(box, { x: 0, y: band, width: bodyWidth, height: bodyHeight }),
        bands: [
          normalize(box, { x: bandX, y: 0, width: bandWidth, height: band + bodyHeight * 0.1 }),
          normalize(box, { x: bandX, y: band + bodyHeight * 0.9, width: bandWidth, height: band + bodyHeight * 0.1 }),
        ],
        crown: normalize(box, { x: bodyWidth - 0.01, y: band + bodyHeight * 0.28, width: 0.1, height: bodyHeight * 0.2 }),
      },
    }
  }
  const screenWidth = 1 - bezel * 2
  const screenHeight = screenWidth / model.screenAspect
  const bodyHeight = screenHeight + bezel * 2
  const grabber = model.family === 'headset' && !frameless ? 0.06 : 0
  const portraitBox = { width: 1, height: bodyHeight + grabber }
  const body = normalize(portraitBox, { x: 0, y: 0, width: 1, height: bodyHeight })
  const screen = normalize(portraitBox, { x: bezel, y: bezel, width: screenWidth, height: screenHeight })
  const parts: ProceduralParts = {
    ...empty,
    body,
    grabber: grabber ? normalize(portraitBox, { x: 0.4, y: bodyHeight + grabber * 0.45, width: 0.2, height: grabber * 0.25 }) : null,
  }
  if (!landscape) {
    return { aspect: portraitBox.width / portraitBox.height, screen, screenRadius: model.screenRadius, bodyRadius: model.bodyRadius, landscape, parts }
  }
  const swap = (rect: FramePart): FramePart => ({ x: rect.y, y: 1 - rect.x - rect.width, width: rect.height, height: rect.width })
  return {
    aspect: portraitBox.height / portraitBox.width,
    screen: swap(screen),
    screenRadius: model.screenRadius,
    bodyRadius: model.bodyRadius,
    landscape,
    parts: { ...parts, body: swap(body), grabber: null },
  }
}

/**
 * Frame geometry for a device frame. `imageAspect` is used by screen-only
 * presentation, which takes the screenshot's own proportions.
 */
export function deviceGeometry(frame: DeviceFrame, imageAspect: number): DeviceGeometry {
  const model = getDeviceModel(frame.modelId)
  const landscape = frame.orientation === 'landscape' && model.supportsLandscape
  if (frame.style === 'screen-only') {
    return {
      aspect: imageAspect,
      screen: { x: 0, y: 0, width: 1, height: 1 },
      screenRadius: 0.02,
      bodyRadius: 0.02,
      landscape: false,
      parts: null,
    }
  }
  const photo = photoFrameFor(frame)
  if (photo?.asset) {
    return {
      aspect: photo.aspectRatio,
      screen: photo.asset.screen,
      screenRadius: model.screenRadius,
      bodyRadius: model.bodyRadius,
      landscape: false,
      parts: null,
    }
  }
  return proceduralGeometry(model, landscape, frame.style === 'frameless')
}

/** Human label for a device style. */
export const DEVICE_STYLE_LABELS: Record<DeviceStyle, string> = {
  realistic: 'Realistic',
  clay: 'Clay',
  frameless: 'Frameless',
  'screen-only': 'Screen only',
}
