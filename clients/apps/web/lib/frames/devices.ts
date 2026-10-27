import type { MockupDefinition } from '@/types/mockup'
import type { DeviceOrientation } from './schema'

/**
 * Devices drawn in-house as SVG, parameterized by color and orientation. No
 * vendor artwork is copied: each model is a handful of measured rectangles
 * (body, screen, camera, buttons, stand) in millimetres, close enough to the
 * real proportions that a screenshot sits where it would on the device.
 */

/** How a drawn device is drawn. */
export type DeviceArtKind = 'phone' | 'tablet' | 'laptop' | 'imac' | 'display' | 'vision'

/** One finish of a drawn device. */
export type DeviceArtColor = {
  id: string
  label: string
  /** Body (rim, lid, chin, glass tint for Vision Pro). */
  body: string
  /** Secondary metal: buttons, base, stand. */
  trim: string
}

/** A rectangle in a device's own units. */
export type DeviceArtRect = { x: number; y: number; width: number; height: number; radius: number }

/** Body and screen of a drawn device in one orientation. */
export type DeviceArtGeometry = {
  width: number
  height: number
  screen: DeviceArtRect
}

/** A drawn device. Geometry is for its native (first) orientation. */
export type DeviceArt = DeviceArtGeometry & {
  kind: DeviceArtKind
  bodyRadius: number
  colors: readonly DeviceArtColor[]
  /** Supported orientations; the first is native. */
  orientations: readonly DeviceOrientation[]
  /** Geometry for an orientation that is not a rotation of the native one. */
  alternate?: Partial<Record<DeviceOrientation, DeviceArtGeometry>>
}

const PIXEL: DeviceArt = {
  kind: 'phone',
  width: 72,
  height: 152.8,
  bodyRadius: 11,
  screen: { x: 2.65, y: 2, width: 66.7, height: 148.8, radius: 8.6 },
  orientations: ['portrait', 'landscape'],
  colors: [
    { id: 'obsidian', label: 'Obsidian', body: '#2b2d30', trim: '#45484c' },
    { id: 'porcelain', label: 'Porcelain', body: '#ece6dc', trim: '#d6cfc3' },
    { id: 'hazel', label: 'Hazel', body: '#8f978b', trim: '#a9b0a5' },
    { id: 'rose-quartz', label: 'Rose Quartz', body: '#f0c7c3', trim: '#dfb1ad' },
  ],
}

const GALAXY: DeviceArt = {
  kind: 'phone',
  width: 77.6,
  height: 162.8,
  bodyRadius: 4.6,
  screen: { x: 2.02, y: 1.7, width: 73.56, height: 159.4, radius: 3 },
  orientations: ['portrait', 'landscape'],
  colors: [
    { id: 'titanium-silverblue', label: 'Titanium Silverblue', body: '#a8b5c3', trim: '#c3ccd6' },
    { id: 'titanium-black', label: 'Titanium Black', body: '#2c2d30', trim: '#4a4c50' },
    { id: 'titanium-gray', label: 'Titanium Gray', body: '#8e8d89', trim: '#a8a7a3' },
    { id: 'titanium-whitesilver', label: 'Titanium Whitesilver', body: '#e3e3e1', trim: '#cfcfcc' },
  ],
}

const IPAD_PRO: DeviceArt = {
  kind: 'tablet',
  width: 215.5,
  height: 281.6,
  bodyRadius: 13,
  screen: { x: 7, y: 6.45, width: 201.5, height: 268.7, radius: 7 },
  orientations: ['portrait', 'landscape'],
  colors: [
    { id: 'space-black', label: 'Space Black', body: '#3a3a3c', trim: '#55565a' },
    { id: 'silver', label: 'Silver', body: '#e2e3e5', trim: '#c9cacc' },
  ],
}

const IPAD_AIR: DeviceArt = {
  kind: 'tablet',
  width: 178.5,
  height: 247.6,
  bodyRadius: 12,
  screen: { x: 9.5, y: 9.05, width: 159.5, height: 229.5, radius: 7.5 },
  orientations: ['portrait', 'landscape'],
  colors: [
    { id: 'space-gray', label: 'Space Gray', body: '#6d6e72', trim: '#86878b' },
    { id: 'blue', label: 'Blue', body: '#a5b3c7', trim: '#bcc7d6' },
    { id: 'purple', label: 'Purple', body: '#c8c0dc', trim: '#d8d2e7' },
    { id: 'starlight', label: 'Starlight', body: '#e6ded2', trim: '#d3cabd' },
  ],
}

const MACBOOK_AIR: DeviceArt = {
  kind: 'laptop',
  width: 340,
  height: 207,
  bodyRadius: 9,
  screen: { x: 30, y: 10, width: 280, height: 182, radius: 2 },
  orientations: ['landscape'],
  colors: [
    { id: 'midnight', label: 'Midnight', body: '#2f3642', trim: '#3c4452' },
    { id: 'starlight', label: 'Starlight', body: '#e5dccd', trim: '#d4cab9' },
    { id: 'space-gray', label: 'Space Gray', body: '#7d7e82', trim: '#929397' },
    { id: 'silver', label: 'Silver', body: '#d9dadc', trim: '#c4c5c8' },
  ],
}

const IMAC: DeviceArt = {
  kind: 'imac',
  width: 547,
  height: 461,
  bodyRadius: 12,
  screen: { x: 12.5, y: 12.5, width: 522, height: 293.6, radius: 1 },
  orientations: ['landscape'],
  colors: [
    { id: 'blue', label: 'Blue', body: '#5b86bd', trim: '#46709f' },
    { id: 'green', label: 'Green', body: '#6aa986', trim: '#548c6d' },
    { id: 'pink', label: 'Pink', body: '#e49a99', trim: '#c97f7e' },
    { id: 'silver', label: 'Silver', body: '#cfd0d3', trim: '#b4b5b8' },
    { id: 'yellow', label: 'Yellow', body: '#eec55f', trim: '#d2a947' },
    { id: 'orange', label: 'Orange', body: '#eb9157', trim: '#cf7841' },
    { id: 'purple', label: 'Purple', body: '#9e8ac8', trim: '#8471ad' },
  ],
}

const STUDIO_DISPLAY: DeviceArt = {
  kind: 'display',
  width: 623,
  height: 478,
  bodyRadius: 7,
  screen: { x: 16, y: 16, width: 591, height: 332.4, radius: 1 },
  orientations: ['landscape'],
  colors: [{ id: 'silver', label: 'Silver', body: '#cdced1', trim: '#b7b8bb' }],
}

const VISION_PRO: DeviceArt = {
  kind: 'vision',
  width: 1000,
  height: 690,
  bodyRadius: 46,
  screen: { x: 14, y: 14, width: 972, height: 597, radius: 34 },
  orientations: ['landscape', 'portrait'],
  alternate: {
    portrait: {
      width: 640,
      height: 1000,
      screen: { x: 14, y: 14, width: 612, height: 907, radius: 34 },
    },
  },
  colors: [
    {
      id: 'light-glass',
      label: 'Light glass',
      body: 'rgba(255,255,255,0.34)',
      trim: 'rgba(255,255,255,0.75)',
    },
    {
      id: 'dark-glass',
      label: 'Dark glass',
      body: 'rgba(30,30,34,0.62)',
      trim: 'rgba(255,255,255,0.42)',
    },
  ],
}

const definition = (
  id: string,
  name: string,
  family: MockupDefinition['family'],
  art: DeviceArt
): MockupDefinition => ({
  aspectRatio: art.width / art.height,
  art,
  family,
  finish: 'dark',
  id,
  name,
  perspective: 'front',
})

/** The drawn devices, as catalog definitions beside the licensed PNG devices. */
export const DRAWN_DEVICE_DEFINITIONS: readonly MockupDefinition[] = [
  definition('pixel-9-pro', 'Google Pixel 9 Pro', 'phone', PIXEL),
  definition('galaxy-s25-ultra', 'Samsung Galaxy S25 Ultra', 'phone', GALAXY),
  definition('ipad-pro-13', 'iPad Pro 13-inch', 'tablet', IPAD_PRO),
  definition('ipad-air-11', 'iPad Air 11-inch', 'tablet', IPAD_AIR),
  definition('macbook-air-13', 'MacBook Air 13-inch', 'laptop', MACBOOK_AIR),
  definition('imac-24', 'iMac 24-inch', 'desktop', IMAC),
  definition('studio-display', 'Apple Studio Display', 'desktop', STUDIO_DISPLAY),
  definition('vision-pro-window', 'Apple Vision Pro', 'spatial', VISION_PRO),
]

/**
 * A drawn device's geometry in an orientation. An unsupported orientation
 * falls back to the native one; a rotation turns the device a quarter turn
 * counter-clockwise, so the screenshot itself stays upright.
 */
export function deviceArtGeometry(
  art: DeviceArt,
  orientation?: DeviceOrientation
): DeviceArtGeometry & { rotated: boolean } {
  const native = art.orientations[0]
  const wanted = orientation && art.orientations.includes(orientation) ? orientation : native
  if (wanted === native)
    return { height: art.height, rotated: false, screen: art.screen, width: art.width }
  const alternate = art.alternate?.[wanted]
  if (alternate) return { ...alternate, rotated: false }
  const { screen } = art
  return {
    height: art.width,
    rotated: true,
    screen: {
      height: screen.width,
      radius: screen.radius,
      width: screen.height,
      x: screen.y,
      y: art.width - (screen.x + screen.width),
    },
    width: art.height,
  }
}

/** A drawn device's color by id, or its first color. */
export function deviceArtColor(art: DeviceArt, colorId?: string): DeviceArtColor {
  return art.colors.find((color) => color.id === colorId) ?? art.colors[0]!
}
