import type { EditorSelection } from '@/lib/editor/selection'
import type { CanvasElement } from '@/lib/editor/elements/schema'
import { getMockupDefinition } from '@/lib/constants/mockups'
import type { ImageState } from '@/lib/store'
import type { LayerProperty, MotionTarget } from './motion-schema'
import { LAYER_PROPERTY_RANGES } from './motion-schema'

/**
 * What can be animated on each layer, and how its values read in the UI.
 * Values are stored in normalized units; the UI shows percentages and degrees.
 */

/** The layer a selection animates, or null for a selection that has no motion. */
export function selectionTarget(selection: EditorSelection): MotionTarget | null {
  if (!selection) return null
  switch (selection.kind) {
    case 'image':
      return { kind: 'image' }
    case 'text':
    case 'sticker':
    case 'device':
    case 'element':
      return selection.id ? { id: selection.id, kind: selection.kind } : null
    default:
      return null
  }
}

const BASE_PROPERTIES: LayerProperty[] = ['x', 'y', 'scale', 'rotation', 'opacity']

/** The properties a layer can animate: transform and opacity, plus its effect parameters. */
export function animatableProperties(element?: CanvasElement): LayerProperty[] {
  if (element?.type === 'spotlight') return [...BASE_PROPERTIES, 'dim', 'feather']
  if (element?.type === 'callout') return [...BASE_PROPERTIES, 'zoom']
  return BASE_PROPERTIES
}

/** Display names of animatable properties. */
export const PROPERTY_LABELS: Record<LayerProperty, string> = {
  dim: 'Dim',
  feather: 'Feather',
  opacity: 'Opacity',
  rotation: 'Rotation',
  scale: 'Scale',
  x: 'Move X',
  y: 'Move Y',
  zoom: 'Zoom',
}

/** How a property's stored value is shown: percentages, degrees, or a multiplier. */
const DISPLAY: Record<LayerProperty, { factor: number; step: number; suffix: string }> = {
  dim: { factor: 100, step: 1, suffix: '%' },
  feather: { factor: 100, step: 1, suffix: '%' },
  opacity: { factor: 100, step: 1, suffix: '%' },
  rotation: { factor: 1, step: 1, suffix: '°' },
  scale: { factor: 100, step: 1, suffix: '%' },
  x: { factor: 100, step: 0.5, suffix: '%' },
  y: { factor: 100, step: 0.5, suffix: '%' },
  zoom: { factor: 1, step: 0.1, suffix: '×' },
}

/** A property's value in the units the UI shows, with its range and step. */
export function propertyDisplay(property: LayerProperty) {
  const { factor, step, suffix } = DISPLAY[property]
  const range = LAYER_PROPERTY_RANGES[property]
  return {
    fromDisplay: (shown: number) => shown / factor,
    max: range.max * factor,
    min: range.min * factor,
    step,
    suffix,
    toDisplay: (value: number) => Math.round(value * factor * 100) / 100,
  }
}

/**
 * A property's own value on a layer with no motion: the identity for
 * transforms, and the element's own setting for effect parameters.
 */
export function restingValue(property: LayerProperty, element?: CanvasElement): number {
  if (element?.type === 'spotlight' && (property === 'dim' || property === 'feather'))
    return element.props[property]
  if (element?.type === 'callout' && property === 'zoom') return element.props.zoom
  return LAYER_PROPERTY_RANGES[property].identity
}

/** A short name for an animated layer, for timeline rows; null when the layer is gone. */
export function targetLabel(state: ImageState, target: MotionTarget): string | null {
  switch (target.kind) {
    case 'image':
      return state.uploadedImageUrl ? (state.imageName ?? 'Screenshot') : null
    case 'text': {
      const text = state.textOverlays.find((item) => item.id === target.id)
      return text ? `“${text.text.slice(0, 24)}”` : null
    }
    case 'sticker': {
      const index = state.imageOverlays.findIndex((item) => item.id === target.id)
      return index >= 0 ? `Sticker ${index + 1}` : null
    }
    case 'device': {
      const device = state.mockups.find((item) => item.id === target.id)
      return device ? (getMockupDefinition(device.definitionId)?.name ?? 'Device') : null
    }
    case 'element': {
      const element = state.elements.find((item) => item.id === target.id)
      return element
        ? (element.name ?? element.type.charAt(0).toUpperCase() + element.type.slice(1))
        : null
    }
  }
}
