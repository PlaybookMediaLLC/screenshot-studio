import { designCatalog, type designCatalogSections } from './catalog'
import { designTemplates } from './templates'

/**
 * One section of the design catalog, shaped for a model to read. Shared by
 * every agent that edits designs (campaign studio, editor copilot).
 */
export function describeDesignCatalog(section: (typeof designCatalogSections)[number]) {
  switch (section) {
    case 'templates':
      return designTemplates.map(({ aspectRatio, description, id, kind, name, usesCopy }) => ({
        aspectRatio,
        description,
        id,
        kind,
        name,
        usesCopy,
      }))
    case 'aspectRatios':
      return designCatalog.aspectRatios
    case 'backgrounds':
      return {
        gradients: designCatalog.gradients,
        images: designCatalog.backgroundImages,
        magicGradients: designCatalog.magicGradients,
        meshGradients: designCatalog.meshGradients,
        solidColors: designCatalog.solidColors,
      }
    case 'fonts':
      return designCatalog.fonts
    case 'mockups':
      return { layouts: designCatalog.deviceLayouts, mockups: designCatalog.mockups }
    case 'frames':
      return {
        frames: designCatalog.frames,
        patterns: designCatalog.patterns,
        shadowPresets: designCatalog.shadowPresets,
      }
    case 'overlays':
      return { arrows: designCatalog.arrowOverlays, shadows: designCatalog.shadowOverlays }
    case 'animation':
      return designCatalog.animationPresets
  }
}

/**
 * The whole catalog as compact JSON, for one-shot calls (critique, directions)
 * that cannot look options up with a tool.
 */
export function describeWholeCatalog(): string {
  return JSON.stringify({
    animationPresets: designCatalog.animationPresets,
    arrowOverlays: designCatalog.arrowOverlays,
    aspectRatios: designCatalog.aspectRatios,
    backgroundImages: designCatalog.backgroundImages,
    deviceLayouts: designCatalog.deviceLayouts,
    fonts: designCatalog.fonts.map((font) => font.id),
    frames: designCatalog.frames,
    gradients: designCatalog.gradients,
    magicGradients: designCatalog.magicGradients,
    meshGradients: designCatalog.meshGradients,
    mockups: designCatalog.mockups.map((mockup) => `${mockup.id} (${mockup.family})`),
    patterns: designCatalog.patterns,
    shadowPresets: designCatalog.shadowPresets,
    solidColors: designCatalog.solidColors,
    templates: designTemplates.map((template) => `${template.id}: ${template.description}`),
  })
}
