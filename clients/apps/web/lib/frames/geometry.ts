import { getMockupDefinition } from '@/lib/constants/mockups'
import type { MockupDefinition } from '@/types/mockup'
import { codeAspect } from './code'
import { deviceArtGeometry } from './devices'
import {
  type CodeContent,
  DEFAULT_FRAME_CHROME,
  type DeviceOrientation,
  type FrameChrome,
  type FrameKind,
  type ScreenFrame,
} from './schema'

/**
 * Frame geometry: where a frame's screen sits inside its box. Pure, so the
 * editor, previews, exports, and motion (scroll-through) all agree.
 *
 * Browser and window chrome is measured in chrome units: one unit is 1% of
 * the content's width, or of three quarters of its height when the content is
 * tall, so a frame keeps its proportions at any canvas or export size.
 */

/** A rectangle: top-left corner and size. */
export type Rect = { x: number; y: number; width: number; height: number }

/** Chrome thickness on each side of the content. */
export type Insets = { top: number; right: number; bottom: number; left: number }

/** A frame as the renderer and geometry need it. */
export type FrameSpec =
  | { kind: 'none' }
  | { kind: 'browser' | 'window'; chrome: FrameChrome }
  | { kind: 'device'; definitionId: string; orientation?: DeviceOrientation }

/** What geometry needs of a screen, in the editor store or in a document. */
export type ScreenShape = {
  definitionId: string
  frame?: ScreenFrame
  orientation?: DeviceOrientation
  screen: { aspect?: number; code?: CodeContent }
}

/** Content aspect used before a screen's image has been measured. */
export const FALLBACK_CONTENT_ASPECT = 16 / 10

const NO_INSETS: Insets = { bottom: 0, left: 0, right: 0, top: 0 }

/** Height of one row of browser chrome, in chrome units. */
const ROW = { bookmarks: 2.3, safariTabs: 2.7, tabStrip: 3.1, toolbar: 3.1 }
/** Width of Arc's sidebar and its window margin, in chrome units. */
export const ARC_SIDEBAR_UNITS = 15.5
export const ARC_MARGIN_UNITS = 0.8

/** The chrome around browser or window content, in chrome units. */
export function chromeInsetUnits(kind: 'browser' | 'window', chrome: FrameChrome): Insets {
  const bookmarks = chrome.showBookmarks ? ROW.bookmarks : 0
  if (kind === 'window') {
    const top = {
      macos: 2.8,
      'terminal-macos': 2.8,
      'terminal-minimal': 2.2,
      'terminal-windows': 3.4,
      windows: 3.2,
    }[chrome.window]
    return { ...NO_INSETS, top }
  }
  switch (chrome.browser) {
    case 'safari':
      return { ...NO_INSETS, top: 3.8 + (chrome.tabs.length > 1 ? ROW.safariTabs : 0) + bookmarks }
    case 'arc':
      return {
        bottom: ARC_MARGIN_UNITS,
        left: ARC_SIDEBAR_UNITS,
        right: ARC_MARGIN_UNITS,
        top: ARC_MARGIN_UNITS,
      }
    default:
      return { ...NO_INSETS, top: ROW.tabStrip + ROW.toolbar + bookmarks }
  }
}

/** Pixels per chrome unit for content of this size; `scale` enlarges the chrome. */
export function chromeUnit(content: { width: number; height: number }, scale = 1): number {
  return (Math.max(content.width, content.height * 0.75) / 100) * scale
}

const toPixels = (insets: Insets, unit: number): Insets => ({
  bottom: insets.bottom * unit,
  left: insets.left * unit,
  right: insets.right * unit,
  top: insets.top * unit,
})

/** A chrome frame's box for content of a given size. */
export function chromeBoxForContent(
  kind: 'browser' | 'window',
  chrome: FrameChrome,
  content: { width: number; height: number },
  scale = 1
): { height: number; insets: Insets; unit: number; width: number } {
  const unit = chromeUnit(content, scale)
  const insets = toPixels(chromeInsetUnits(kind, chrome), unit)
  return {
    height: content.height + insets.top + insets.bottom,
    insets,
    unit,
    width: content.width + insets.left + insets.right,
  }
}

/** The content rectangle of a chrome frame filling `box`, and its chrome unit. */
export function chromeContentRect(
  kind: 'browser' | 'window',
  chrome: FrameChrome,
  box: Rect,
  scale = 1
): Rect & { unit: number } {
  const units = chromeInsetUnits(kind, chrome)
  const across = units.left + units.right
  const down = units.top + units.bottom
  // The unit follows the content width, unless the content is tall.
  let width = box.width / (1 + (across * scale) / 100)
  let unit = (width * scale) / 100
  let height = box.height - down * unit
  if (width < height * 0.75) {
    height = box.height / (1 + (down * 0.75 * scale) / 100)
    unit = (height * 0.75 * scale) / 100
    width = box.width - across * unit
  }
  return { height, unit, width, x: box.x + units.left * unit, y: box.y + units.top * unit }
}

/** The width / height of a chrome frame around content of this aspect. */
export function chromeBoxAspect(
  kind: 'browser' | 'window',
  chrome: FrameChrome,
  contentAspect: number
): number {
  const box = chromeBoxForContent(kind, chrome, { height: 100 / contentAspect, width: 100 })
  return box.width / box.height
}

/** A device's box aspect and screen (as fractions of the box) in an orientation. */
export function deviceGeometry(
  definition: MockupDefinition,
  orientation?: DeviceOrientation
): { aspectRatio: number; screen: Rect; screenRadius: number } {
  if (definition.art) {
    const geometry = deviceArtGeometry(definition.art, orientation)
    const { screen } = geometry
    return {
      aspectRatio: geometry.width / geometry.height,
      screen: {
        height: screen.height / geometry.height,
        width: screen.width / geometry.width,
        x: screen.x / geometry.width,
        y: screen.y / geometry.height,
      },
      screenRadius: screen.radius / geometry.width,
    }
  }
  return {
    aspectRatio: definition.aspectRatio,
    screen: definition.asset?.screen ?? { height: 1, width: 1, x: 0, y: 0 },
    screenRadius: 0,
  }
}

/**
 * Where a frame's screen (the screenshot's pixels) sits inside a box of the
 * frame's own aspect. Motion's scroll-through uses this to know what to move.
 */
export function frameScreenRect(frame: FrameSpec, box: Rect, scale = 1): Rect {
  if (frame.kind === 'none') return { ...box }
  if (frame.kind === 'device') {
    const definition = getMockupDefinition(frame.definitionId)
    if (!definition) return { ...box }
    const { screen } = deviceGeometry(definition, frame.orientation)
    return {
      height: screen.height * box.height,
      width: screen.width * box.width,
      x: box.x + screen.x * box.width,
      y: box.y + screen.y * box.height,
    }
  }
  const { height, width, x, y } = chromeContentRect(frame.kind, frame.chrome, box, scale)
  return { height, width, x, y }
}

/** The frame kind a screen uses; screens from before frames were devices. */
export function screenFrameKind(mockup: Pick<ScreenShape, 'frame'>): FrameKind {
  return mockup.frame?.kind ?? 'device'
}

/** A screen's frame as the renderer needs it. */
export function screenFrameSpec(mockup: Omit<ScreenShape, 'screen'>): FrameSpec {
  const kind = screenFrameKind(mockup)
  if (kind === 'device')
    return { definitionId: mockup.definitionId, kind, orientation: mockup.orientation }
  if (kind === 'none') return { kind }
  return { chrome: mockup.frame?.chrome ?? DEFAULT_FRAME_CHROME, kind }
}

/** The width / height of a screen's content: its code, its image, or a fallback. */
export function screenContentAspect(mockup: Pick<ScreenShape, 'screen'>): number {
  if (mockup.screen.code) return codeAspect(mockup.screen.code)
  return mockup.screen.aspect && Number.isFinite(mockup.screen.aspect)
    ? mockup.screen.aspect
    : FALLBACK_CONTENT_ASPECT
}

/** The width / height of a screen's whole box, frame included. */
export function screenBoxAspect(mockup: ScreenShape): number {
  const frame = screenFrameSpec(mockup)
  if (frame.kind === 'device') {
    const definition = getMockupDefinition(frame.definitionId)
    return definition ? deviceGeometry(definition, frame.orientation).aspectRatio : 1
  }
  const content = screenContentAspect(mockup)
  return frame.kind === 'none' ? content : chromeBoxAspect(frame.kind, frame.chrome, content)
}
