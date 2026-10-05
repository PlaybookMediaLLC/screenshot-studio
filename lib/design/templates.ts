import { presets } from '@/lib/constants/presets'
import { IMAGE_TEMPLATES } from '@/lib/templates/image-templates'
import { getMockupDefinition } from '@/lib/constants/mockups'
import { DESIGN_DOCUMENT_VERSION, type DesignDocument, designDocumentSchema } from './document'

/**
 * Design templates: the starting points the AI (or a person) builds from.
 *
 * Two kinds, one id space:
 *
 * - Editor templates and presets, used exactly as the editor ships them
 *   (`template-violet-showcase`, `spotlight`, …). A document naming one is
 *   loaded through `applyVisualPreset`, so it is pixel-identical to picking it
 *   in the editor's template drawer.
 * - Layouts, which start from an editor template and fill slots: the
 *   product screenshot, an optional mobile screenshot for phone frames, and
 *   headline copy positioned for the layout's format.
 *
 * Every result is a plain DesignDocument, so variations are just patches.
 */

export type DesignSlots = {
  /** Main screenshot, `asset:<id>`. */
  screenshot: string
  /** Phone-shaped screenshot for phone frames; falls back to `screenshot`. */
  mobileScreenshot?: string
  headline?: string
  subheadline?: string
  /** Text color for headline copy; defaults to the layout's choice. */
  textColor?: string
}

export type DesignTemplate = {
  id: string
  name: string
  description: string
  kind: 'editor-template' | 'editor-preset' | 'layout'
  aspectRatio: string
  /** Whether the template places headline copy. */
  usesCopy: boolean
  build: (slots: DesignSlots) => DesignDocument
}

type Headline = {
  /** Canvas width / height, so vertical spacing stays even across formats. */
  aspect: number
  color: string
  fontFamily?: string
  size: number
  subSize: number
  y: number
}

/**
 * Editor text is a single line, so a size is capped to keep the line inside
 * ~90% of the canvas width (average glyph ≈ 0.55em).
 */
export function fitFontSize(text: string, preferred: number): number {
  return Math.min(preferred, 0.9 / Math.max(1, text.length * 0.55))
}

function headlineTexts(slots: DesignSlots, headline: Headline): DesignDocument['texts'] {
  const color = slots.textColor ?? headline.color
  const texts: DesignDocument['texts'] = []
  const headlineSize = slots.headline ? fitFontSize(slots.headline, headline.size) : 0
  if (slots.headline) {
    texts.push({
      color,
      fontFamily: (headline.fontFamily ?? 'inter') as never,
      fontSize: headlineSize,
      fontWeight: 'bold',
      opacity: 1,
      orientation: 'horizontal',
      position: { x: 50, y: headline.y },
      text: slots.headline,
    })
  }
  if (slots.subheadline) {
    texts.push({
      color,
      fontFamily: (headline.fontFamily ?? 'inter') as never,
      fontSize: fitFontSize(slots.subheadline, headline.subSize),
      fontWeight: '500',
      opacity: 0.85,
      orientation: 'horizontal',
      position: {
        x: 50,
        y:
          headline.y +
          (headlineSize * headline.aspect * 100 * 0.75 +
            headline.subSize * headline.aspect * 100 * 0.9),
      },
      text: slots.subheadline,
    })
  }
  return texts
}

function document(input: Record<string, unknown>): DesignDocument {
  return designDocumentSchema.parse({ version: DESIGN_DOCUMENT_VERSION, ...input })
}

/** Device scene from an editor template, with each screen pointed at the right capture. */
function deviceScene(templateId: string, slots: DesignSlots, lift = 0) {
  const template = IMAGE_TEMPLATES.find((candidate) => candidate.preset.id === templateId)
  if (!template || template.scene.kind !== 'device') return undefined
  return {
    mockups: template.scene.devices.map((device) => ({
      definitionId: device.definitionId,
      position: { x: device.position.x, y: Math.min(1, device.position.y + lift) },
      rotation: device.rotation,
      screen: {
        fit: 'cover' as const,
        src:
          getMockupDefinition(device.definitionId)?.family === 'laptop'
            ? slots.screenshot
            : (slots.mobileScreenshot ?? slots.screenshot),
      },
      size: device.size,
    })),
  }
}

const editorTemplates: DesignTemplate[] = IMAGE_TEMPLATES.map((template) => ({
  aspectRatio: template.preset.aspectRatio,
  build: (slots) => document({ image: { src: slots.screenshot }, template: template.preset.id }),
  description: template.preset.description,
  id: template.preset.id,
  kind: 'editor-template' as const,
  name: template.preset.name,
  usesCopy: false,
}))

const editorPresets: DesignTemplate[] = presets.map((preset) => ({
  aspectRatio: preset.aspectRatio,
  build: (slots) => document({ image: { src: slots.screenshot }, template: preset.id }),
  description: preset.description,
  id: preset.id,
  kind: 'editor-preset' as const,
  name: preset.name,
  usesCopy: false,
}))

const layouts: DesignTemplate[] = [
  {
    aspectRatio: '16_9',
    build: (slots) =>
      document({
        image: { offset: { x: 0, y: 0.1 }, scale: 86, src: slots.screenshot },
        template: 'template-midnight-focus',
        texts: headlineTexts(slots, {
          aspect: 16 / 9,
          color: '#ffffff',
          size: 0.042,
          subSize: 0.019,
          y: 8,
        }),
      }),
    description: 'Dark spotlight stage with the product below a centred headline.',
    id: 'layout-headline-spotlight',
    kind: 'layout',
    name: 'Headline spotlight',
    usesCopy: true,
  },
  {
    aspectRatio: '16_9',
    build: (slots) =>
      document({
        image: {
          frame: { title: 'app', type: 'macos-dark' },
          offset: { x: 0, y: 0.11 },
          scale: 84,
          shadow: { preset: 'strong' },
          src: slots.screenshot,
        },
        template: 'template-violet-showcase',
        texts: headlineTexts(slots, {
          aspect: 16 / 9,
          color: '#1e1b4b',
          size: 0.04,
          subSize: 0.018,
          y: 7,
        }),
      }),
    description: 'The product in a macOS browser window on a violet stage, headline above.',
    id: 'layout-browser-launch',
    kind: 'layout',
    name: 'Browser launch',
    usesCopy: true,
  },
  {
    aspectRatio: '16_9',
    build: (slots) =>
      document({
        devices: deviceScene('template-laptop-stage', slots, 0.08),
        image: { src: slots.screenshot },
        mode: 'device',
        template: 'template-laptop-stage',
        texts: headlineTexts(slots, {
          aspect: 16 / 9,
          color: '#111827',
          size: 0.04,
          subSize: 0.018,
          y: 7,
        }),
      }),
    description: 'A laptop on a studio stage showing the product, headline above.',
    id: 'layout-laptop-launch',
    kind: 'layout',
    name: 'Laptop launch',
    usesCopy: true,
  },
  {
    aspectRatio: '16_9',
    build: (slots) =>
      document({
        devices: deviceScene('template-product-suite', slots, 0.06),
        image: { src: slots.screenshot },
        mode: 'device',
        template: 'template-product-suite',
        texts: headlineTexts(slots, {
          aspect: 16 / 9,
          color: '#ffffff',
          size: 0.038,
          subSize: 0.017,
          y: 6,
        }),
      }),
    description: 'Laptop, phone, and watch together for cross-platform launches.',
    id: 'layout-product-suite',
    kind: 'layout',
    name: 'Product suite',
    usesCopy: true,
  },
  {
    aspectRatio: '16_9',
    build: (slots) =>
      document({
        devices: deviceScene('template-phone-duo', slots),
        image: { src: slots.screenshot },
        mode: 'device',
        template: 'template-phone-duo',
      }),
    description: 'Two phones, one in perspective, for mobile-first features.',
    id: 'layout-phone-duo',
    kind: 'layout',
    name: 'Phone duo',
    usesCopy: false,
  },
  {
    aspectRatio: '1_1',
    build: (slots) =>
      document({
        background: { type: 'gradient', value: 'mesh:mesh_aurora' },
        canvas: { aspectRatio: '1_1' },
        devices: {
          mockups: [
            {
              definitionId: 'iphone-17-pro-front',
              position: { x: 0.5, y: 0.62 },
              screen: { src: slots.mobileScreenshot ?? slots.screenshot },
              size: 0.34,
            },
          ],
        },
        image: { src: slots.screenshot },
        mode: 'device',
        texts: headlineTexts(slots, {
          aspect: 1,
          color: '#ffffff',
          size: 0.06,
          subSize: 0.03,
          y: 8,
        }),
      }),
    description: 'Square social card: one phone with a bold headline.',
    id: 'layout-social-phone',
    kind: 'layout',
    name: 'Social phone card',
    usesCopy: true,
  },
  {
    aspectRatio: '9_16',
    build: (slots) =>
      document({
        background: { type: 'gradient', value: 'mesh:mesh_sunset' },
        canvas: { aspectRatio: '9_16' },
        devices: {
          mockups: [
            {
              definitionId: 'iphone-17-pro-front',
              position: { x: 0.5, y: 0.58 },
              screen: { src: slots.mobileScreenshot ?? slots.screenshot },
              size: 0.64,
            },
          ],
        },
        image: { src: slots.screenshot },
        mode: 'device',
        texts: headlineTexts(slots, {
          aspect: 9 / 16,
          color: '#ffffff',
          size: 0.085,
          subSize: 0.042,
          y: 7,
        }),
      }),
    description: 'Vertical story format with a large phone and headline.',
    id: 'layout-story-phone',
    kind: 'layout',
    name: 'Story phone',
    usesCopy: true,
  },
  {
    aspectRatio: '16_9',
    build: (slots) =>
      document({
        image: { offset: { x: 0, y: 0.1 }, scale: 84, src: slots.screenshot },
        template: 'template-editorial-paper',
        texts: headlineTexts(slots, {
          aspect: 16 / 9,
          color: '#111827',
          fontFamily: 'playfair-display',
          size: 0.042,
          subSize: 0.018,
          y: 7,
        }),
      }),
    description: 'Light editorial paper stage with a serif headline.',
    id: 'layout-editorial',
    kind: 'layout',
    name: 'Editorial',
    usesCopy: true,
  },
]

export const designTemplates: DesignTemplate[] = [...layouts, ...editorTemplates, ...editorPresets]

export function getDesignTemplate(id: string): DesignTemplate | undefined {
  return designTemplates.find((template) => template.id === id)
}

/** The editor preset (and scene, for image templates) behind a document's `template`. */
export function resolveEditorTemplate(id: string | undefined) {
  if (!id) return undefined
  const imageTemplate = IMAGE_TEMPLATES.find((template) => template.preset.id === id)
  if (imageTemplate) return { preset: imageTemplate.preset, scene: imageTemplate.scene }
  const preset = presets.find((candidate) => candidate.id === id)
  return preset ? { preset, scene: undefined } : undefined
}
