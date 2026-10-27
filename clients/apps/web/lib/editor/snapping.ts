import type { SafeZone } from '@/lib/store/canvas-guides'

/**
 * Snapping and composition guides: pure geometry in stage px, shared by every
 * draggable layer so the screenshot, text, stickers, devices, and elements
 * snap to the same lines with the same tolerance.
 */

/** A rectangle in stage px. */
export type SnapBox = { height: number; width: number; x: number; y: number }

/** Lines to snap to: x positions of vertical lines, y positions of horizontal lines. */
export type SnapLines = { horizontal: number[]; vertical: number[] }

/** The canvas's own lines: edges and centre, plus thirds when shown. */
export function canvasSnapLines(width: number, height: number, thirds = false): SnapLines {
  const vertical = [0, width / 2, width]
  const horizontal = [0, height / 2, height]
  if (thirds) {
    vertical.push(width / 3, (2 * width) / 3)
    horizontal.push(height / 3, (2 * height) / 3)
  }
  return { horizontal, vertical }
}

/** Edges and centres of other objects. */
export function objectSnapLines(boxes: readonly SnapBox[]): SnapLines {
  return {
    horizontal: boxes.flatMap((box) => [box.y, box.y + box.height / 2, box.y + box.height]),
    vertical: boxes.flatMap((box) => [box.x, box.x + box.width / 2, box.x + box.width]),
  }
}

/** Both sets of lines together. */
export function mergeSnapLines(...sets: SnapLines[]): SnapLines {
  return {
    horizontal: sets.flatMap((set) => set.horizontal),
    vertical: sets.flatMap((set) => set.vertical),
  }
}

function nearest(candidates: number[], lines: number[], tolerance: number) {
  let best: { delta: number; line: number } | null = null
  for (const candidate of candidates) {
    for (const line of lines) {
      const delta = line - candidate
      if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, line }
      }
    }
  }
  return best
}

/** Where a dragged box snaps: the shift to apply and the lines it snapped to. */
export type SnapResult = { dx: number; dy: number; horizontal: number | null; vertical: number | null }

/** Snap a box's edges and centre to the nearest lines within `tolerance`. */
export function snapBox(box: SnapBox, lines: SnapLines, tolerance: number): SnapResult {
  const vertical = nearest([box.x, box.x + box.width / 2, box.x + box.width], lines.vertical, tolerance)
  const horizontal = nearest([box.y, box.y + box.height / 2, box.y + box.height], lines.horizontal, tolerance)
  return {
    dx: vertical?.delta ?? 0,
    dy: horizontal?.delta ?? 0,
    horizontal: horizontal?.line ?? null,
    vertical: vertical?.line ?? null,
  }
}

/** Where a platform's UI covers the image, as fractions of each side. */
export type SafeInsets = { bottom: number; left: number; right: number; top: number }

/**
 * Approximate safe areas per platform, from each platform's published
 * creative guidance; platforms change their UI, so these are guides, not
 * guarantees.
 */
export const SAFE_ZONES: Record<Exclude<SafeZone, 'none'>, { insets: SafeInsets; label: string; note: string }> = {
  'app-store-iphone': {
    insets: { bottom: 0.04, left: 0.04, right: 0.04, top: 0.06 },
    label: 'App Store (iPhone)',
    note: 'Keep text clear of the rounded display corners and the status bar.',
  },
  'instagram-reel': {
    insets: { bottom: 0.25, left: 0.06, right: 0.17, top: 0.11 },
    label: 'Instagram Reel',
    note: 'Caption, audio, and action buttons cover the bottom and right.',
  },
  'instagram-story': {
    insets: { bottom: 0.18, left: 0.06, right: 0.06, top: 0.13 },
    label: 'Instagram Story',
    note: 'Profile bar on top, reply bar at the bottom.',
  },
  tiktok: {
    insets: { bottom: 0.26, left: 0.06, right: 0.15, top: 0.08 },
    label: 'TikTok',
    note: 'Caption and buttons cover the bottom and right edge.',
  },
  'x-feed-crop': {
    insets: { bottom: 0, left: 0, right: 0, top: 0 },
    label: 'X feed (16:9 crop)',
    note: 'The feed shows a centred 16:9 crop of taller images.',
  },
  'youtube-shorts': {
    insets: { bottom: 0.21, left: 0.06, right: 0.13, top: 0.08 },
    label: 'YouTube Shorts',
    note: 'Title, channel, and buttons cover the bottom and right.',
  },
}

/** The visible rectangle of a safe zone on a canvas, in stage px. */
export function safeZoneRect(zone: Exclude<SafeZone, 'none'>, width: number, height: number): SnapBox {
  if (zone === 'x-feed-crop') {
    const cropHeight = Math.min(height, (width * 9) / 16)
    return { height: cropHeight, width, x: 0, y: (height - cropHeight) / 2 }
  }
  const { bottom, left, right, top } = SAFE_ZONES[zone].insets
  return {
    height: height * (1 - top - bottom),
    width: width * (1 - left - right),
    x: width * left,
    y: height * top,
  }
}
