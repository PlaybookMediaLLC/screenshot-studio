import { z } from 'zod'
import { arrangeScreens, documentCanvasAspect } from '@/lib/frames/arrange'
import { compositionLayoutSchema } from '@/lib/frames/layouts'
import type { DesignDocument } from '@/lib/design/document'
import type { TextAlign, TextFill, TextFit, TextRole } from './text-style'

/**
 * Typography templates: headline/subheadline pairings for marketing
 * graphics and App Store screenshots. A template replaces the layers that
 * play its roles and keeps the words already written in them, so trying a
 * style never loses copy. Sizes are fractions of the canvas width, like
 * every text in a design.
 */

/** Where a template is meant to be used. */
export const typographyUseSchema = z.enum(['marketing', 'app-store'])

type TemplateLayer = {
  align: TextAlign
  color: string
  fill?: TextFill
  fit: TextFit
  fontFamily: string
  fontWeight: string
  letterSpacing?: number
  lineHeight?: number
  /** Text box width, fraction of the canvas width. */
  maxWidth: number
  /** Centre of the text box, percent of the canvas. */
  position: { x: number; y: number }
  role: TextRole
  /** Font size, fraction of the canvas width. */
  size: number
  text: string
}

/** A typography template. */
export type TypographyTemplate = {
  description: string
  id: string
  layers: readonly TemplateLayer[]
  name: string
  use: z.infer<typeof typographyUseSchema>
}

const headline = (layer: Partial<TemplateLayer>): TemplateLayer => ({
  align: 'center',
  color: '#ffffff',
  fit: 'shrink',
  fontFamily: 'inter',
  fontWeight: 'bold',
  maxWidth: 0.86,
  position: { x: 50, y: 13 },
  role: 'headline',
  size: 0.06,
  text: 'Your product, beautifully shown',
  ...layer,
})
const subheadline = (layer: Partial<TemplateLayer>): TemplateLayer => ({
  align: 'center',
  color: 'rgba(255,255,255,0.82)',
  fit: 'wrap',
  fontFamily: 'inter',
  fontWeight: 'normal',
  lineHeight: 1.35,
  maxWidth: 0.7,
  position: { x: 50, y: 22 },
  role: 'subheadline',
  size: 0.024,
  text: 'A short line that explains why it matters',
  ...layer,
})

/** The editor's typography templates. */
export const TYPOGRAPHY_TEMPLATES: readonly TypographyTemplate[] = [
  {
    description: 'Large, confident headline with a quiet line under it.',
    id: 'bold-hero',
    layers: [headline({ fontWeight: '800', letterSpacing: -0.02 }), subheadline({})],
    name: 'Bold hero',
    use: 'marketing',
  },
  {
    description: 'Gradient headline for launches and announcements.',
    id: 'gradient-launch',
    layers: [
      headline({
        fill: { angle: 90, from: '#ff7a18', kind: 'gradient', to: '#af002d' },
        fontFamily: 'google:Plus Jakarta Sans',
        fontWeight: '800',
        letterSpacing: -0.02,
      }),
      subheadline({ fontFamily: 'google:Plus Jakarta Sans' }),
    ],
    name: 'Gradient launch',
    use: 'marketing',
  },
  {
    description: 'Editorial serif headline with a sans-serif line.',
    id: 'editorial',
    layers: [
      headline({ fontFamily: 'google:Instrument Serif', fontWeight: 'normal', size: 0.07 }),
      subheadline({ letterSpacing: 0.01 }),
    ],
    name: 'Editorial',
    use: 'marketing',
  },
  {
    description: 'A small label above the headline, aligned left.',
    id: 'label-feature',
    layers: [
      {
        align: 'left',
        color: 'rgba(255,255,255,0.7)',
        fit: 'shrink',
        fontFamily: 'inter',
        fontWeight: '600',
        letterSpacing: 0.18,
        maxWidth: 0.6,
        position: { x: 38, y: 9 },
        role: 'label',
        size: 0.016,
        text: 'NEW FEATURE',
      },
      headline({ align: 'left', maxWidth: 0.6, position: { x: 38, y: 15 }, size: 0.05 }),
      subheadline({ align: 'left', maxWidth: 0.6, position: { x: 38, y: 23 } }),
    ],
    name: 'Label + headline',
    use: 'marketing',
  },
  {
    description: 'Monospace headline for developer tools.',
    id: 'developer',
    layers: [
      headline({ fontFamily: 'google:JetBrains Mono', fontWeight: '800', size: 0.05 }),
      subheadline({ fontFamily: 'google:JetBrains Mono', size: 0.02 }),
    ],
    name: 'Developer',
    use: 'marketing',
  },
  {
    description: 'Big caption above the device, sized for App Store screenshots.',
    id: 'app-store-caption',
    layers: [
      headline({ fontFamily: 'sf-pro-display', fontWeight: 'bold', maxWidth: 0.88, position: { x: 50, y: 8 }, size: 0.085 }),
      subheadline({ fontFamily: 'sf-pro-display', maxWidth: 0.82, position: { x: 50, y: 15 }, size: 0.04 }),
    ],
    name: 'App Store caption',
    use: 'app-store',
  },
]

/**
 * The design's texts with a template applied: the template's layers replace
 * the texts playing the same roles (keeping their words), and every other
 * text stays as it is.
 */
export function withTypographyTemplate(
  texts: DesignDocument['texts'],
  template: TypographyTemplate
): DesignDocument['texts'] {
  const roles = new Set(template.layers.map((layer) => layer.role))
  const existing = new Map(texts.filter((text) => text.role).map((text) => [text.role!, text]))
  const kept = texts.filter((text) => !text.role || !roles.has(text.role))
  const placed = template.layers.map((layer) => {
    const previous = existing.get(layer.role)
    return {
      align: layer.align,
      color: layer.color,
      fill: layer.fill,
      fit: layer.fit,
      fontFamily: layer.fontFamily,
      fontSize: layer.size,
      fontWeight: layer.fontWeight,
      id: previous?.id,
      letterSpacing: layer.letterSpacing,
      lineHeight: layer.lineHeight,
      maxWidth: layer.maxWidth,
      opacity: 1,
      orientation: 'horizontal' as const,
      position: { ...layer.position },
      role: layer.role,
      shadow: { blur: 12, color: 'rgba(0,0,0,0.25)', enabled: true, offsetX: 0, offsetY: 2 },
      text: previous?.text ?? layer.text,
      visible: previous?.visible,
    }
  })
  return [...kept, ...placed]
}

/** Reserve a copy band and arrange media below it as one template operation. */
export function withTypographyLayout(document: DesignDocument, template: TypographyTemplate): DesignDocument {
  const texts = withTypographyTemplate(document.texts, template)
  const roles = new Set(template.layers.map((layer) => layer.role))
  const aspect = documentCanvasAspect(document)
  let y = 0.04
  const placed = texts.map((text) => {
    if (!text.role || !roles.has(text.role)) return text
    const fontSize = Math.min(text.fontSize, (text.role === 'headline' ? 0.065 : 0.032) / aspect)
    const lineHeight = text.lineHeight ?? 1.2
    const lines = text.fit === 'wrap' ? Math.max(1, Math.ceil(text.text.length * fontSize * 0.55 / (text.maxWidth ?? 0.8))) : 1
    const height = Math.min(0.15, fontSize * aspect * lineHeight * lines)
    const position = { ...text.position, y: (y + height / 2) * 100 }
    y += height + 0.02
    return { ...text, fontSize, position }
  })
  const top = Math.min(0.45, y + 0.03)
  const body = 1 - top
  const layout = compositionLayoutSchema.safeParse(document.devices?.layoutId)
  return {
    ...document,
    texts: placed.map((text) => text.role && roles.has(text.role) ? text : { ...text, position: { ...text.position, y: top * 100 + text.position.y * body } }),
    devices: document.devices ? { ...document.devices,
      mockups: arrangeScreens(document.devices.mockups, layout.success ? layout.data : 'grid', aspect / body).map((screen) => ({ ...screen, position: { ...screen.position, y: top + screen.position.y * body } })),
    } : undefined,
    image: document.devices?.mockups.length ? { ...document.image, scale: 100, offset: { x: 0, y: 0 } } : {
      ...document.image, scale: Math.max(10, Math.min(document.image.scale ?? 100, 100 * body)), offset: { x: 0, y: top / 2 },
    },
  }
}
