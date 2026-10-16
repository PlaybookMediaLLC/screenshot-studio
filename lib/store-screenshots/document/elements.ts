import { IDENTITY_TRANSFORM, newId } from './factory'
import type { AnnotationKind, AnnotationLayer, CalloutLayer, ImageLayer } from './schema'

/**
 * Factories for elements the user adds from the Insert menu. Text that
 * makes a claim (ratings, awards, rankings) starts empty or as an obvious
 * placeholder; the editor never invents a rating or an award.
 */

/** Display names for annotation kinds. */
export const ANNOTATION_LABELS: Record<AnnotationKind, string> = {
  step: 'Numbered step',
  label: 'Feature label',
  arrow: 'Arrow',
  highlight: 'Highlight',
  rating: 'Rating',
  laurel: 'Award laurel',
  badge: 'Badge',
}

/** Kinds whose text is a claim the user must be able to substantiate. */
export const CLAIM_KINDS: ReadonlySet<AnnotationKind> = new Set(['rating', 'laurel', 'badge'])

const DEFAULTS: Record<AnnotationKind, Pick<AnnotationLayer, 'text' | 'caption' | 'value' | 'height' | 'strokeWidth' | 'curve' | 'shape'> & { width: number }> = {
  step: { text: '', caption: '', value: 1, width: 9, height: 4.1, strokeWidth: 0, curve: 0, shape: 'ellipse' },
  label: { text: 'New', caption: '', value: 0, width: 26, height: 4.2, strokeWidth: 0, curve: 0, shape: 'rectangle' },
  arrow: { text: '', caption: '', value: 0, width: 24, height: 6, strokeWidth: 8, curve: 0.35, shape: 'rectangle' },
  highlight: { text: '', caption: '', value: 0, width: 40, height: 8, strokeWidth: 8, curve: 0, shape: 'rectangle' },
  rating: { text: '', caption: '', value: 5, width: 44, height: 5, strokeWidth: 0, curve: 0, shape: 'rectangle' },
  laurel: { text: 'Your award', caption: 'Add the source', value: 0, width: 56, height: 8, strokeWidth: 0, curve: 0, shape: 'rectangle' },
  badge: { text: 'Your claim', caption: '', value: 0, width: 36, height: 5.5, strokeWidth: 0, curve: 0, shape: 'rectangle' },
}

/** A new annotation centred at (x, y) slide percent. */
export function createAnnotation(kind: AnnotationKind, accent: string, x = 50, y = 30): AnnotationLayer {
  const defaults = DEFAULTS[kind]
  const filled = kind === 'step' || kind === 'label' || kind === 'badge'
  return {
    id: newId(),
    name: ANNOTATION_LABELS[kind],
    hidden: false,
    locked: false,
    groupId: null,
    opacity: 1,
    transform: { ...IDENTITY_TRANSFORM },
    type: 'annotation',
    kind,
    placement: { mode: 'free', x, y, width: defaults.width },
    height: defaults.height,
    text: defaults.text,
    caption: defaults.caption,
    color: kind === 'rating' || kind === 'laurel' ? '#F5B301' : accent,
    fill: filled ? accent : null,
    textColor: filled ? '#FFFFFF' : '#111111',
    strokeWidth: defaults.strokeWidth,
    value: defaults.value,
    curve: defaults.curve,
    shape: defaults.shape,
  }
}

/** A new magnified callout of the centre of a device's screenshot. */
export function createCallout(deviceLayerId: string, x = 72, y = 40): CalloutLayer {
  return {
    id: newId(),
    name: 'Magnified callout',
    hidden: false,
    locked: false,
    groupId: null,
    opacity: 1,
    transform: { ...IDENTITY_TRANSFORM },
    type: 'callout',
    deviceLayerId,
    region: { x: 0.35, y: 0.35, width: 0.3, height: 0.18 },
    placement: { mode: 'free', x, y, width: 38 },
    shape: 'circle',
    borderWidth: 8,
    borderColor: '#FFFFFF',
    shadow: 45,
    connector: true,
  }
}

/** A new free image layer (logo, sticker). */
export function createImageLayer(assetId: string, name: string): ImageLayer {
  return {
    id: newId(),
    name: name.replace(/\.[^/.]+$/, '').slice(0, 80) || 'Image',
    hidden: false,
    locked: false,
    groupId: null,
    opacity: 1,
    transform: { ...IDENTITY_TRANSFORM },
    type: 'image',
    placement: { mode: 'free', x: 50, y: 20, width: 24 },
    assetId,
  }
}
