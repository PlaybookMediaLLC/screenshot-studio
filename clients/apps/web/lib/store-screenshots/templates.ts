import { z } from 'zod'
import { DEFAULT_TEXT_STYLES, createDocument, createStandardSlide, newId, publicAsset, STARTER_SCREENS } from './document/factory'
import { createAnnotation } from './document/elements'
import {
  annotationLayerSchema,
  backgroundSchema,
  deviceFrameSchema,
  hexColorSchema,
  layoutIdSchema,
  textStyleSchema,
  type StoreDocument,
  type StoreLayer,
  type TextRole,
} from './document/schema'
import { defaultDeviceFrame } from './devices'

/**
 * Templates: reusable design structure, separate from content. A template
 * holds the theme (type, colors, device), a rhythm of slide layouts and
 * backgrounds, and placeholder copy and decorations for new projects. It
 * never holds screenshots, so a template saved from one app can dress
 * another app's screenshots.
 */

/** Built-in template categories. */
export const templateCategorySchema = z.enum([
  'fitness',
  'finance',
  'productivity',
  'games',
  'education',
  'health',
  'saas',
  'ecommerce',
  'general',
  'saved',
])

/** One slide of a template. */
export const templateSlideSchema = z.object({
  layout: layoutIdSchema,
  background: backgroundSchema,
  heading: z.string().max(200),
  subheading: z.string().max(300),
  /** Decorations for new projects; positions are slide percentages. */
  decorations: z.array(annotationLayerSchema).max(10),
})

/** A template. */
export const templateSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  category: templateCategorySchema,
  description: z.string().max(240),
  theme: z.object({
    textStyles: z.object({ heading: textStyleSchema, subheading: textStyleSchema, body: textStyleSchema }),
    deviceFrame: deviceFrameSchema,
    shadow: z.number().min(0).max(100),
    palette: z.array(hexColorSchema).max(12),
    background: backgroundSchema,
  }),
  slides: z.array(templateSlideSchema).min(1).max(30),
})

/** Template category. */
export type TemplateCategory = z.infer<typeof templateCategorySchema>
/** Template. */
export type StoreTemplate = z.infer<typeof templateSchema>
/** Template slide. */
export type TemplateSlide = z.infer<typeof templateSlideSchema>

const font = {
  inter: 'var(--font-inter), system-ui, sans-serif',
  sora: 'var(--font-sora), system-ui, sans-serif',
  bebas: 'var(--font-bebas-neue), Arial Narrow, sans-serif',
  playfair: 'var(--font-playfair-display), Georgia, serif',
  dmSans: 'var(--font-dm-sans), system-ui, sans-serif',
  spaceGrotesk: 'var(--font-space-grotesk), system-ui, sans-serif',
  lexend: 'var(--font-lexend), system-ui, sans-serif',
  outfit: 'var(--font-outfit), system-ui, sans-serif',
  manrope: 'var(--font-manrope), system-ui, sans-serif',
  righteous: 'var(--font-righteous), system-ui, sans-serif',
  lora: 'var(--font-lora), Georgia, serif',
}

function styles(heading: { fontFamily: string; fontWeight: number; fontSize?: number; uppercase?: boolean; letterSpacing?: number; lineHeight?: number; italic?: boolean }, body: string, color: string | null = null) {
  return {
    heading: { ...DEFAULT_TEXT_STYLES.heading, color, fontSize: heading.fontSize ?? 96, fontFamily: heading.fontFamily, fontWeight: heading.fontWeight, uppercase: heading.uppercase ?? false, letterSpacing: heading.letterSpacing ?? -0.03, lineHeight: heading.lineHeight ?? 1.05, italic: heading.italic ?? false },
    subheading: { ...DEFAULT_TEXT_STYLES.subheading, fontFamily: body, color: null },
    body: { ...DEFAULT_TEXT_STYLES.body, fontFamily: body, color: null },
  }
}

const linear = (from: string, to: string, angle = 180) => ({ kind: 'linear' as const, from, to, angle })
const solid = (color: string) => ({ kind: 'solid' as const, color })

function deco(kind: Parameters<typeof createAnnotation>[0], accent: string, x: number, y: number, patch: Partial<ReturnType<typeof createAnnotation>> = {}) {
  return { ...createAnnotation(kind, accent, x, y), id: `tpl-${kind}-${x}-${y}`, ...patch }
}

/** The built-in templates. Each has its own type system, rhythm, and palette. */
export const BUILT_IN_TEMPLATES: StoreTemplate[] = [
  {
    id: 'fitness-pulse',
    name: 'Pulse',
    category: 'fitness',
    description: 'Condensed uppercase headlines on high-energy dark gradients, devices tilted for motion.',
    theme: {
      textStyles: styles({ fontFamily: font.bebas, fontWeight: 400, fontSize: 132, uppercase: true, letterSpacing: 0.01, lineHeight: 0.95 }, font.inter),
      deviceFrame: { ...defaultDeviceFrame(), finishId: 'cosmic-orange' },
      shadow: 70,
      palette: ['#FF5A1F', '#FFD60A', '#0B0B0F', '#FFFFFF', '#22D3EE', '#A3E635'],
      background: linear('#0B0B0F', '#3A0CA3', 160),
    },
    slides: [
      { layout: 'offset', background: linear('#0B0B0F', '#FF5A1F', 155), heading: 'Train with purpose', subheading: 'Plans that adapt to every session', decorations: [] },
      { layout: 'editorial-right', background: linear('#111827', '#3A0CA3', 160), heading: 'Track every rep', subheading: 'Sets, weight, and rest in one tap', decorations: [deco('step', '#FF5A1F', 14, 30, { value: 1 })] },
      { layout: 'duo', background: linear('#0B0B0F', '#0E7490', 150), heading: 'See your progress', subheading: '', decorations: [] },
      { layout: 'hero', background: linear('#1F0A3A', '#FF5A1F', 170), heading: 'Recover smarter', subheading: 'Readiness that guides your next workout', decorations: [] },
    ],
  },
  {
    id: 'finance-ledger',
    name: 'Ledger',
    category: 'finance',
    description: 'Calm serif headlines, cream paper tones, and upright devices that read as trustworthy.',
    theme: {
      textStyles: styles({ fontFamily: font.playfair, fontWeight: 600, fontSize: 92, letterSpacing: -0.01, lineHeight: 1.08 }, font.dmSans),
      deviceFrame: { ...defaultDeviceFrame(), finishId: 'silver' },
      shadow: 30,
      palette: ['#0F3D2E', '#C9A227', '#F7F3EA', '#111111', '#2563EB', '#E11D48'],
      background: solid('#F7F3EA'),
    },
    slides: [
      { layout: 'classic', background: solid('#F7F3EA'), heading: 'Know where your money goes', subheading: 'Every account, in one calm view', decorations: [] },
      { layout: 'editorial-left', background: linear('#F7F3EA', '#E8DFC8', 180), heading: 'Budgets that stick', subheading: 'Gentle nudges before you overspend', decorations: [deco('label', '#0F3D2E', 22, 30, { text: 'Automatic' })] },
      { layout: 'classic', background: solid('#0F3D2E'), heading: 'Plan for what matters', subheading: 'Goals with clear timelines', decorations: [] },
      { layout: 'minimal', background: solid('#F7F3EA'), heading: 'Private by design', subheading: '', decorations: [] },
    ],
  },
  {
    id: 'productivity-grid',
    name: 'Grid',
    category: 'productivity',
    description: 'Crisp geometric sans, white space, and a three-device workflow slide.',
    theme: {
      textStyles: styles({ fontFamily: font.spaceGrotesk, fontWeight: 700, fontSize: 90, letterSpacing: -0.04 }, font.inter),
      deviceFrame: { ...defaultDeviceFrame(), modelId: 'iphone-17', finishId: 'white' },
      shadow: 25,
      palette: ['#2563EB', '#111827', '#F3F4F6', '#FFFFFF', '#F59E0B', '#10B981'],
      background: solid('#FFFFFF'),
    },
    slides: [
      { layout: 'classic', background: solid('#F3F4F6'), heading: 'Your day, organized', subheading: 'Tasks, notes, and calendar together', decorations: [] },
      { layout: 'trio', background: linear('#EFF6FF', '#FFFFFF', 180), heading: 'From idea to done', subheading: '', decorations: [deco('step', '#2563EB', 27, 47, { value: 1 }), deco('step', '#2563EB', 73, 47, { value: 2 })] },
      { layout: 'editorial-left', background: solid('#FFFFFF'), heading: 'Focus on one thing', subheading: 'Hide everything else with one tap', decorations: [] },
      { layout: 'tablet-phone', background: solid('#F3F4F6'), heading: 'Works everywhere', subheading: 'Phone, tablet, and Mac stay in sync', decorations: [] },
    ],
  },
  {
    id: 'games-arcade',
    name: 'Arcade',
    category: 'games',
    description: 'Display type, saturated neon gradients, landscape devices for gameplay.',
    theme: {
      textStyles: styles({ fontFamily: font.righteous, fontWeight: 400, fontSize: 104, uppercase: true, letterSpacing: 0.02, lineHeight: 1 }, font.outfit),
      deviceFrame: { ...defaultDeviceFrame(), style: 'frameless' },
      shadow: 80,
      palette: ['#F72585', '#7209B7', '#4CC9F0', '#FFD60A', '#0B0B0F', '#FFFFFF'],
      background: linear('#7209B7', '#F72585', 140),
    },
    slides: [
      { layout: 'hero', background: linear('#3A0CA3', '#F72585', 140), heading: 'Jump in', subheading: 'Quick rounds, endless levels', decorations: [] },
      { layout: 'offset', background: linear('#0B0B0F', '#4CC9F0', 150), heading: 'Build your squad', subheading: '', decorations: [deco('label', '#FFD60A', 24, 32, { text: 'New mode', textColor: '#0B0B0F' })] },
      { layout: 'duo', background: linear('#F72585', '#FFD60A', 160), heading: 'Play with friends', subheading: 'Real-time matches', decorations: [] },
    ],
  },
  {
    id: 'education-chalk',
    name: 'Chalk',
    category: 'education',
    description: 'Friendly rounded type, soft pastel paper, numbered learning steps.',
    theme: {
      textStyles: styles({ fontFamily: font.lexend, fontWeight: 600, fontSize: 88, letterSpacing: -0.02, lineHeight: 1.1 }, font.lexend),
      deviceFrame: { ...defaultDeviceFrame(), modelId: 'iphone-17', finishId: 'sage', style: 'clay' },
      shadow: 20,
      palette: ['#2F855A', '#F6AD55', '#FFFBEB', '#1A202C', '#805AD5', '#E53E3E'],
      background: solid('#FFFBEB'),
    },
    slides: [
      { layout: 'classic', background: solid('#FFFBEB'), heading: 'Learn a little every day', subheading: 'Five-minute lessons that stick', decorations: [deco('step', '#2F855A', 16, 26, { value: 1 })] },
      { layout: 'editorial-right', background: solid('#F0FFF4'), heading: 'Practice makes progress', subheading: 'Exercises adapt to your level', decorations: [deco('step', '#2F855A', 84, 26, { value: 2 })] },
      { layout: 'classic', background: solid('#FAF5FF'), heading: 'Celebrate milestones', subheading: 'Streaks and badges keep you going', decorations: [deco('step', '#2F855A', 16, 26, { value: 3 })] },
    ],
  },
  {
    id: 'health-calm',
    name: 'Calm',
    category: 'health',
    description: 'Light, airy type on soft gradients with frameless screens and generous margins.',
    theme: {
      textStyles: styles({ fontFamily: font.manrope, fontWeight: 500, fontSize: 84, letterSpacing: -0.03, lineHeight: 1.12 }, font.manrope),
      deviceFrame: { ...defaultDeviceFrame(), modelId: 'iphone-air', finishId: 'cloud-white' },
      shadow: 25,
      palette: ['#0EA5E9', '#14B8A6', '#F0F9FF', '#0F172A', '#F472B6', '#A78BFA'],
      background: linear('#F0F9FF', '#E0F2FE', 180),
    },
    slides: [
      { layout: 'minimal', background: linear('#F0F9FF', '#CCFBF1', 180), heading: 'Breathe easier', subheading: 'Guided sessions for any moment', decorations: [] },
      { layout: 'classic', background: linear('#FDF2F8', '#F0F9FF', 180), heading: 'Sleep, measured', subheading: 'Gentle insights each morning', decorations: [] },
      { layout: 'editorial-left', background: linear('#F5F3FF', '#F0F9FF', 180), heading: 'Habits that last', subheading: 'Small steps, tracked kindly', decorations: [deco('highlight', '#14B8A6', 60, 62, { shape: 'ellipse', fill: null })] },
    ],
  },
  {
    id: 'saas-console',
    name: 'Console',
    category: 'saas',
    description: 'Monochrome dark UI, tight geometric headings, tablet-and-phone hero for cross-device products.',
    theme: {
      textStyles: styles({ fontFamily: font.inter, fontWeight: 700, fontSize: 90, letterSpacing: -0.045 }, font.inter),
      deviceFrame: { ...defaultDeviceFrame(), finishId: 'deep-blue' },
      shadow: 55,
      palette: ['#6366F1', '#22D3EE', '#0B0B0F', '#FAFAFA', '#F43F5E', '#A3E635'],
      background: solid('#0B0B0F'),
    },
    slides: [
      { layout: 'tablet-phone', background: linear('#0B0B0F', '#1E1B4B', 165), heading: 'Your team, in sync', subheading: 'Projects, chat, and docs in one place', decorations: [] },
      { layout: 'editorial-left', background: solid('#0B0B0F'), heading: 'Ship faster', subheading: 'Automations handle the busywork', decorations: [deco('label', '#6366F1', 22, 30, { text: 'Automations' })] },
      { layout: 'duo', background: linear('#111827', '#0B0B0F', 180), heading: 'Every metric that matters', subheading: '', decorations: [] },
    ],
  },
  {
    id: 'ecommerce-boutique',
    name: 'Boutique',
    category: 'ecommerce',
    description: 'Editorial serif with italic accents, warm neutrals, and product-first framing.',
    theme: {
      textStyles: styles({ fontFamily: font.lora, fontWeight: 600, fontSize: 94, italic: true, letterSpacing: -0.01, lineHeight: 1.08 }, font.dmSans),
      deviceFrame: { ...defaultDeviceFrame(), modelId: 'iphone-17', finishId: 'lavender' },
      shadow: 40,
      palette: ['#9A3412', '#FDE68A', '#FAF5EF', '#1C1917', '#BE185D', '#0F766E'],
      background: solid('#FAF5EF'),
    },
    slides: [
      { layout: 'hero', background: linear('#FAF5EF', '#F5E1D3', 180), heading: 'Find your style', subheading: 'New arrivals every week', decorations: [deco('label', '#9A3412', 76, 22, { text: 'New in' })] },
      { layout: 'editorial-right', background: solid('#F5E1D3'), heading: 'Checkout in seconds', subheading: 'Saved sizes and one-tap pay', decorations: [] },
      { layout: 'classic', background: solid('#1C1917'), heading: 'Track every order', subheading: 'Live updates to your door', decorations: [] },
      { layout: 'minimal', background: solid('#FAF5EF'), heading: 'Wishlists that remember', subheading: '', decorations: [] },
    ],
  },
]

function templateTextStyles(template: StoreTemplate) {
  return structuredClone(template.theme.textStyles) as Record<TextRole, (typeof template.theme.textStyles)['heading']>
}

/**
 * Apply a template's design to an existing project: theme, slide layouts
 * and backgrounds (cycled), device frames, and the template's typography.
 * Copy, screenshots, and added elements stay; slide-level style overrides
 * and manual positions are cleared so the template reads as designed.
 */
export function applyTemplateToDocument(document: StoreDocument, template: StoreTemplate): StoreDocument {
  const slides = document.slides.map((slide, index) => {
    const spec = template.slides[index % template.slides.length]
    const layers: StoreLayer[] = slide.layers.map((layer) => {
      if (layer.type === 'text') return { ...layer, style: {}, transform: { ...layer.transform, offsetX: 0, offsetY: 0, rotation: 0, scale: 1 } }
      if (layer.type === 'device') return { ...layer, frame: { ...template.theme.deviceFrame }, transform: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, tiltX: 0, tiltY: 0 } }
      return layer
    })
    return { ...slide, layout: spec.layout, background: structuredClone(spec.background), backgroundSpan: null, layers, targetOverrides: {} }
  })
  return {
    ...document,
    templateId: template.id,
    theme: {
      ...document.theme,
      background: structuredClone(template.theme.background),
      textStyles: templateTextStyles(template),
      deviceFrame: { ...template.theme.deviceFrame },
      shadow: template.theme.shadow,
      palette: [...template.theme.palette],
    },
    slides,
  }
}

/** A new project from a template, with sample screens and placeholder copy. */
export function createDocumentFromTemplate(template: StoreTemplate): StoreDocument {
  const assets: StoreDocument['assets'] = {}
  const slides = template.slides.map((spec, index) => {
    const screen = STARTER_SCREENS[index % STARTER_SCREENS.length]
    const asset = publicAsset(screen.src, screen.name)
    assets[asset.id] = asset
    const slide = createStandardSlide(spec.heading.split(' ').slice(0, 3).join(' ') || `Slide ${index + 1}`, asset.id, spec.heading, spec.subheading, template.theme.deviceFrame)
    slide.layout = spec.layout
    slide.background = structuredClone(spec.background)
    slide.layers.push(...spec.decorations.map((layer) => ({ ...structuredClone(layer), id: newId() })))
    return slide
  })
  const document = createDocument({ name: `${template.name} set`, slides, assets, templateId: template.id })
  return applyTemplateToDocument(document, template)
}

/** Capture a project's design as a reusable template (no screenshots). */
export function templateFromDocument(document: StoreDocument, name: string): StoreTemplate {
  return {
    id: `user:${newId()}`,
    name: name.trim().slice(0, 80) || 'My template',
    category: 'saved',
    description: `Saved from “${document.name}” (${document.slides.length} slides).`,
    theme: {
      textStyles: structuredClone(document.theme.textStyles),
      deviceFrame: { ...document.theme.deviceFrame },
      shadow: document.theme.shadow,
      palette: [...document.theme.palette],
      background: document.theme.background.kind === 'image' ? solid(document.theme.background.color) : structuredClone(document.theme.background),
    },
    slides: document.slides.map((slide, index) => {
      const heading = slide.layers.find((layer) => layer.type === 'text' && layer.role === 'heading')
      const subheading = slide.layers.find((layer) => layer.type === 'text' && layer.role === 'subheading')
      const background = slide.background ?? document.theme.background
      return {
        layout: slide.layout ?? (['classic', 'hero', 'editorial-left'] as const)[index % 3],
        background: background.kind === 'image' ? solid(background.color) : structuredClone(background),
        heading: heading?.type === 'text' ? heading.content.map((span) => span.text).join('') : '',
        subheading: subheading?.type === 'text' ? subheading.content.map((span) => span.text).join('') : '',
        decorations: slide.layers.filter((layer) => layer.type === 'annotation').map((layer) => structuredClone(layer)) as StoreTemplate['slides'][number]['decorations'],
      }
    }),
  }
}
