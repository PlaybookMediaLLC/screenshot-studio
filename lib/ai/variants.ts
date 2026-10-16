import { z } from 'zod'
import type { DesignChanges } from '@/lib/design/document'

/**
 * Copilot variants: several complete versions of a design to compare. A set
 * is only useful if its versions differ in composition, not just colour, so
 * each proposal is classified by the design axes it changes and checked
 * against the ones already accepted.
 */

/** The aspects of a design a variant can change. */
export const variantAxisSchema = z.enum([
  'layout',
  'frame',
  'perspective',
  'typography',
  'background',
  'decoration',
  'motion',
])
/** A design axis. */
export type VariantAxis = z.infer<typeof variantAxisSchema>

/** How many versions a request may ask for. */
export const variantCountSchema = z.number().int().min(2).max(6)

const SECTION_AXES: Record<string, VariantAxis> = {
  animation: 'motion',
  annotations: 'decoration',
  background: 'background',
  canvas: 'layout',
  devices: 'frame',
  elements: 'decoration',
  mode: 'frame',
  overlays: 'decoration',
  pattern: 'background',
  texts: 'typography',
  timeline: 'motion',
}

const IMAGE_AXES: Record<string, VariantAxis> = {
  browserHeaderSize: 'frame',
  frame: 'frame',
  offset: 'layout',
  perspective: 'perspective',
  radius: 'frame',
  rotation: 'layout',
  scale: 'layout',
  shadow: 'frame',
}

/** The axes a set of changes touches. */
export function variantAxes(changes: DesignChanges): Set<VariantAxis> {
  const axes = new Set<VariantAxis>()
  for (const [section, value] of Object.entries(changes)) {
    if (value === undefined) continue
    if (section === 'image' && value && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        const axis = IMAGE_AXES[key]
        if (axis) axes.add(axis)
      }
    } else if (SECTION_AXES[section]) {
      axes.add(SECTION_AXES[section])
    }
  }
  return axes
}

/** True when an instruction asks for colour or background variations specifically. */
export function wantsColourOnly(instruction: string | undefined): boolean {
  return /\b(colou?rs?|palettes?|backgrounds?|tones?|hues?)\b/i.test(instruction ?? '')
}

/**
 * Why a proposal is not distinct enough from the accepted ones, or null when
 * it is. A variant must change the composition (not only its background)
 * unless the user asked for colour variations, and must not repeat another
 * variant's changes.
 */
export function distinctnessProblem(
  changes: DesignChanges,
  accepted: readonly DesignChanges[],
  instruction?: string
): string | null {
  const axes = variantAxes(changes)
  if (axes.size === 0) return 'This variation changes nothing.'
  const compositional = [...axes].filter((axis) => axis !== 'background')
  if (!wantsColourOnly(instruction) && compositional.length === 0) {
    return 'Change the composition too (layout, frame, perspective, or typography), not only the background.'
  }
  const key = JSON.stringify(changes)
  if (accepted.some((other) => JSON.stringify(other) === key))
    return 'This repeats another variation.'
  const signature = [...axes].sort().join(',')
  const sameAxes = accepted.filter(
    (other) => [...variantAxes(other)].sort().join(',') === signature
  ).length
  if (!wantsColourOnly(instruction) && sameAxes >= 2) {
    return `Two variations already change exactly ${signature}. Vary a different aspect.`
  }
  return null
}
