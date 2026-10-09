import { ANIMATION_PRESETS } from '@/lib/animation/presets'
import { aspectRatios } from '@/lib/constants/aspect-ratios'
import { fontFamilies } from '@/lib/constants/fonts'
import { gradientColors } from '@/lib/constants/gradient-colors'
import { magicGradients, meshGradients } from '@/lib/constants/mesh-gradients'
import { DEVICE_LAYOUTS, MOCKUP_DEFINITIONS } from '@/lib/constants/mockups'
import { solidColors } from '@/lib/constants/solid-colors'
import { backgroundCategories } from '@/lib/r2-backgrounds'
import { ARROW_PATHS, SHADOW_OVERLAY_PATHS } from '@/lib/r2-overlays'

/**
 * Everything the editor can render, as plain id lists.
 *
 * The design document schema validates against these lists, and the AI's
 * catalog tool reads from them, so the model can only choose options the
 * editor actually has. Pure data: safe on the server and in the browser.
 */

const ids = <T extends { id: string }>(items: readonly T[]) => items.map((item) => item.id)

export const designCatalog = {
  animationPresets: ids(ANIMATION_PRESETS),
  arrowOverlays: [...ARROW_PATHS],
  aspectRatios: ids(aspectRatios).filter((id) => id !== 'custom'),
  backgroundImages: backgroundCategories,
  deviceLayouts: ids(DEVICE_LAYOUTS),
  fonts: fontFamilies.map((font) => ({
    category: font.category,
    id: font.id,
    weights: font.availableWeights,
  })),
  frames: [
    'none',
    'arc-light',
    'arc-dark',
    'macos-light',
    'macos-dark',
    'windows-light',
    'windows-dark',
    'photograph',
    'glass-light',
    'glass-dark',
    'outline-light',
    'border-light',
    'border-dark',
  ] as const,
  gradients: Object.keys(gradientColors),
  magicGradients: Object.keys(magicGradients).map((key) => `magic:${key}`),
  meshGradients: Object.keys(meshGradients).map((key) => `mesh:${key}`),
  mockups: MOCKUP_DEFINITIONS.map((mockup) => ({
    family: mockup.family,
    id: mockup.id,
    perspective: mockup.perspective,
  })),
  patterns: ['grid', 'dots', 'lines'] as const,
  shadowOverlays: [...SHADOW_OVERLAY_PATHS],
  shadowPresets: ['none', 'hug', 'soft', 'strong'] as const,
  solidColors: Object.keys(solidColors),
}

export const frameTypes = designCatalog.frames
export type FrameType = (typeof frameTypes)[number]

const backgroundImagePaths = new Set(Object.values(backgroundCategories).flat())
const gradientKeys = new Set(designCatalog.gradients)
const meshKeys = new Set([...designCatalog.meshGradients, ...designCatalog.magicGradients])
const solidKeys = new Set(designCatalog.solidColors)
const cssColor = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/i

/** True when a background value names something the editor can draw. */
export function isKnownBackground(type: 'gradient' | 'image' | 'solid', value: string): boolean {
  if (type === 'gradient') {
    return gradientKeys.has(value) || meshKeys.has(value) || value.startsWith('linear-gradient(')
  }
  if (type === 'solid') return solidKeys.has(value) || cssColor.test(value)
  return backgroundImagePaths.has(value) || value.startsWith('asset:')
}

export const designCatalogSections = [
  'templates',
  'aspectRatios',
  'backgrounds',
  'fonts',
  'mockups',
  'frames',
  'overlays',
  'animation',
] as const
export type DesignCatalogSection = (typeof designCatalogSections)[number]
