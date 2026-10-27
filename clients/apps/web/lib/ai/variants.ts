import { z } from 'zod'
import { type DesignChanges, type DesignDocument, patchDesignDocument } from '@/lib/design/document'

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
  template: 'layout',
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

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * The axes a set of changes touches. With the `base` design, only what the
 * changes actually alter counts: naming a field with its current value does not.
 */
export function variantAxes(changes: DesignChanges, base?: DesignDocument): Set<VariantAxis> {
  const after = base ? patchDesignDocument(base, changes) : null
  const axes = new Set<VariantAxis>()
  for (const [section, value] of Object.entries(changes)) {
    if (value === undefined) continue
    if (section === 'image' && value && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        const axis = IMAGE_AXES[key]
        const field = key as keyof DesignDocument['image']
        if (axis && (!base || !after || !same(base.image[field], after.image[field])))
          axes.add(axis)
      }
    } else if (SECTION_AXES[section]) {
      const key = section as keyof DesignDocument
      if (!base || !after || !same(base[key], after[key])) axes.add(SECTION_AXES[section])
    }
  }
  return axes
}

/** What a variant makes of the changed sections, to tell repeats apart by result. */
function resultKey(changes: DesignChanges, base?: DesignDocument): string {
  if (!base) return JSON.stringify(changes)
  const after = patchDesignDocument(base, changes)
  return JSON.stringify(
    Object.keys(changes)
      .sort()
      .map((key) => after[key as keyof DesignDocument])
  )
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
  instruction?: string,
  base?: DesignDocument
): string | null {
  const axes = variantAxes(changes, base)
  if (axes.size === 0) return 'This variation changes nothing.'
  const compositional = [...axes].filter((axis) => axis !== 'background')
  if (!wantsColourOnly(instruction) && compositional.length === 0) {
    return 'Change the composition too (layout, frame, perspective, or typography), not only the background.'
  }
  const key = resultKey(changes, base)
  if (accepted.some((other) => resultKey(other, base) === key)) {
    return 'This repeats another variation.'
  }
  const signature = [...axes].sort().join(',')
  const sameAxes = accepted.filter(
    (other) => [...variantAxes(other, base)].sort().join(',') === signature
  ).length
  if (!wantsColourOnly(instruction) && sameAxes >= 2) {
    return `Two variations already change exactly ${signature}. Vary a different aspect.`
  }
  return null
}
