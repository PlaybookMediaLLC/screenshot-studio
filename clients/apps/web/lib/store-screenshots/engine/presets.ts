import { z } from 'zod'
import type { DeviceFamily } from '../devices'
import type { LayoutId, StoreDocument, TextStyle } from '../document/schema'

/**
 * Layout presets. A preset describes intent, not final pixels: where the
 * copy block anchors, and where each device slot sits and how far it may
 * bleed off the bottom edge. The scene evaluator measures the copy and moves
 * or shrinks devices so they never collide with it.
 */

/** Where the copy block anchors. */
export const copyAnchorSchema = z.enum(['top', 'middle', 'bottom'])

/** Copy anchor. */
export type CopyAnchor = z.infer<typeof copyAnchorSchema>

/** Copy block intent. Percentages of slide width (x, width) and height (margin). */
export type CopySpec = {
  anchor: CopyAnchor
  align: TextStyle['align']
  /** Left edge of the copy column. */
  x: number
  width: number
  /** Distance from the anchored edge. */
  margin: number
  /** Type scale relative to the theme, e.g. 0.75 for a compact caption. */
  scale: number
  /** Largest share of the slide height the copy may take before auto-fit shrinks it. */
  maxHeight: number
}

/** One device slot. Centre and width in slide percentages; rotation in degrees. */
export type SlotSpec = {
  x: number
  y: number
  width: number
  rotation: number
  /** Fraction of the device's height allowed below the bottom edge. */
  bleed: number
  /** The family this slot is designed for, used when filling empty slots. */
  family?: DeviceFamily
}

/** A layout preset. */
export type LayoutPreset = {
  id: LayoutId
  name: string
  description: string
  copy: CopySpec
  slots: SlotSpec[]
}

/** Every built-in layout, in picker order. */
export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'Centered copy above one centered device.',
    copy: { anchor: 'top', align: 'center', x: 8, width: 84, margin: 5.5, scale: 1, maxHeight: 34 },
    slots: [{ x: 50, y: 61, width: 76, rotation: 0, bleed: 0.06 }],
  },
  {
    id: 'hero',
    name: 'Hero',
    description: 'Bold copy over a large device that runs off the bottom edge.',
    copy: { anchor: 'top', align: 'center', x: 6, width: 88, margin: 5, scale: 1.08, maxHeight: 30 },
    slots: [{ x: 50, y: 69, width: 90, rotation: 0, bleed: 0.3 }],
  },
  {
    id: 'editorial-left',
    name: 'Editorial left',
    description: 'Left-aligned copy with the device leaning in from the right.',
    copy: { anchor: 'top', align: 'left', x: 7, width: 70, margin: 7, scale: 1, maxHeight: 34 },
    slots: [{ x: 60, y: 66, width: 78, rotation: 4, bleed: 0.2 }],
  },
  {
    id: 'editorial-right',
    name: 'Editorial right',
    description: 'Right-aligned copy with the device leaning in from the left.',
    copy: { anchor: 'top', align: 'right', x: 23, width: 70, margin: 7, scale: 1, maxHeight: 34 },
    slots: [{ x: 40, y: 66, width: 78, rotation: -4, bleed: 0.2 }],
  },
  {
    id: 'offset',
    name: 'Offset',
    description: 'Asymmetric copy with a tilted device cropped by the edge.',
    copy: { anchor: 'top', align: 'left', x: 8, width: 72, margin: 6, scale: 1, maxHeight: 32 },
    slots: [{ x: 64, y: 70, width: 85, rotation: 9, bleed: 0.3 }],
  },
  {
    id: 'duo',
    name: 'Duo',
    description: 'Two overlapping devices for richer feature stories.',
    copy: { anchor: 'top', align: 'center', x: 6, width: 88, margin: 5, scale: 1, maxHeight: 30 },
    slots: [
      { x: 35, y: 65, width: 57, rotation: -5, bleed: 0.15 },
      { x: 67, y: 69, width: 60, rotation: 5, bleed: 0.2 },
    ],
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Screen first, with compact copy above it when there is any.',
    copy: { anchor: 'top', align: 'center', x: 10, width: 80, margin: 4, scale: 0.72, maxHeight: 18 },
    slots: [{ x: 50, y: 55, width: 86, rotation: 0, bleed: 0 }],
  },
  {
    id: 'no-mockup',
    name: 'Text only',
    description: 'A typographic slide. Devices stay on the slide but are not shown.',
    copy: { anchor: 'middle', align: 'center', x: 8, width: 84, margin: 0, scale: 1.15, maxHeight: 70 },
    slots: [],
  },
  {
    id: 'tablet-phone',
    name: 'Tablet + phone',
    description: 'A tablet with a phone floating in front of it.',
    copy: { anchor: 'top', align: 'center', x: 8, width: 84, margin: 5, scale: 1, maxHeight: 30 },
    slots: [
      { x: 42, y: 64, width: 82, rotation: 0, bleed: 0.15, family: 'tablet' },
      { x: 74, y: 74, width: 34, rotation: 0, bleed: 0, family: 'phone' },
    ],
  },
  {
    id: 'trio',
    name: 'Trio',
    description: 'Three devices fanned out to show a workflow.',
    copy: { anchor: 'top', align: 'center', x: 8, width: 84, margin: 5, scale: 1, maxHeight: 30 },
    slots: [
      { x: 27, y: 68, width: 46, rotation: -8, bleed: 0.2 },
      { x: 73, y: 68, width: 46, rotation: 8, bleed: 0.2 },
      { x: 50, y: 64, width: 52, rotation: 0, bleed: 0.15 },
    ],
  },
]

const PRESET_BY_ID = new Map(LAYOUT_PRESETS.map((preset) => [preset.id, preset]))

/** A layout preset by id. */
export function getLayoutPreset(id: LayoutId): LayoutPreset {
  return PRESET_BY_ID.get(id) ?? LAYOUT_PRESETS[0]
}

/**
 * Layout rhythms of the built-in templates. A slide whose `layout` is null
 * takes the layout at its position in the rhythm, so reordering slides keeps
 * the set's rhythm.
 */
export const TEMPLATE_SEQUENCES: Record<string, LayoutId[]> = {
  classic: ['classic'],
  hero: ['hero', 'classic', 'hero', 'classic'],
  editorial: ['editorial-left', 'editorial-right', 'classic', 'editorial-left'],
  offset: ['offset', 'editorial-right', 'offset', 'classic'],
  duo: ['duo', 'classic', 'duo', 'hero'],
  minimal: ['minimal'],
}

/** The layout a slide uses. */
export function resolveLayoutId(document: StoreDocument, slideIndex: number): LayoutId {
  const slide = document.slides[slideIndex]
  if (slide?.layout) return slide.layout
  const sequence = TEMPLATE_SEQUENCES[document.templateId] ?? TEMPLATE_SEQUENCES.classic
  return sequence[Math.max(0, slideIndex) % sequence.length]
}
