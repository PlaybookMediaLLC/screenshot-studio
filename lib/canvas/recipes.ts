import { z } from 'zod'
import { designDocumentSchema, type DesignDocument } from '@/lib/design/document'
import { createElement } from '@/lib/editor/elements/schema'
import { adaptDocumentToSize, documentCanvasSize } from '@/lib/export/adapt'
import { composeOutput } from '@/lib/creative-sets/recipes'
import type { Story, StoryFormat, Treatment } from '@/lib/creative-sets/document'
import {
  artboardSchema,
  sizedDesignDocument,
  type Artboard,
  type EvidenceReference,
  type LayerProvenance,
} from './document'
import { ARTBOARD_GAP } from './layout'
import { DEFAULT_FRAME_CHROME } from '@/lib/frames/schema'
import { createCodeContent } from '@/lib/frames/code'
import { container, solidFill, type FillImage } from './blocks'

/**
 * Starting points for software marketing. A recipe builds complete native
 * artboards; a block adds native layers to one artboard. Both produce plain
 * DesignDocuments the editor, renderer and every export already understand,
 * so a generated artboard is exactly as editable as a hand-made one.
 *
 * Grounding: words quoted from a product record are `verified` and carry
 * the record; template wording is `suggested`. Nothing here invents a
 * metric, availability date, testimonial or competitor claim; those slots
 * stay visible placeholders until a person fills them.
 */

/** The artboard sizes offered as presets, in export pixels. */
export const ARTBOARD_PRESETS = {
  'wide-16x9': { name: '16:9 · 1600 × 900', width: 1600, height: 900 },
  'square-1x1': { name: '1:1 · 1080 × 1080', width: 1080, height: 1080 },
  'portrait-4x5': { name: '4:5 · 1080 × 1350', width: 1080, height: 1350 },
  'story-9x16': { name: '9:16 · 1080 × 1920', width: 1080, height: 1920 },
  'open-graph': { name: 'Open Graph · 1200 × 630', width: 1200, height: 630 },
  'linkedin-post': { name: 'LinkedIn · 1200 × 627', width: 1200, height: 627 },
  'slide-16x9': { name: 'Slide · 1920 × 1080', width: 1920, height: 1080 },
  'product-hunt': { name: 'Product Hunt · 1270 × 760', width: 1270, height: 760 },
} as const
/** A preset id. */
export const artboardPresetSchema = z.enum([
  'wide-16x9',
  'square-1x1',
  'portrait-4x5',
  'story-9x16',
  'open-graph',
  'linkedin-post',
  'slide-16x9',
  'product-hunt',
])
/** One of {@link artboardPresetSchema}. */
export type ArtboardPreset = z.infer<typeof artboardPresetSchema>

/** A product screenshot a recipe places. `src` is `asset:<id>` or a local image this page uploads on save. */
export const recipeScreenshotSchema = z.object({
  src: z.string().min(1).max(4_000_000),
  name: z.string().min(1).max(200),
  width: z.number().int().positive().max(32768),
  height: z.number().int().positive().max(32768),
})
/** One of {@link recipeScreenshotSchema}. */
export type RecipeScreenshot = z.infer<typeof recipeScreenshotSchema>

/** Facts quoted from a release record. */
export const releaseEvidenceSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().trim().min(1).max(300),
  benefitStatement: z.string().trim().max(300).optional(),
  url: z.string().url().max(2000).optional(),
  features: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        url: z.string().url().max(2000).optional(),
      })
    )
    .max(20)
    .default([]),
})
/** One of {@link releaseEvidenceSchema}. */
export type ReleaseEvidence = z.infer<typeof releaseEvidenceSchema>

/** What a recipe works from. Every field is optional; missing copy becomes a placeholder. */
export const recipeInputSchema = z.object({
  headline: z.string().trim().max(300).optional(),
  supporting: z.string().trim().max(300).optional(),
  screenshots: z.array(recipeScreenshotSchema).max(6).default([]),
  release: releaseEvidenceSchema.optional(),
  /** Index into `release.features` the artboard announces. */
  featureIndex: z.number().int().min(0).max(19).optional(),
  steps: z.array(z.string().trim().min(1).max(120)).max(6).default([]),
  code: z.string().max(4000).optional(),
})
/** One of {@link recipeInputSchema}. */
export type RecipeInput = z.input<typeof recipeInputSchema>

/** Outcome-first starting points. */
export const canvasRecipeSchema = z.enum([
  'feature-announcement',
  'product-launch',
  'before-after',
  'walkthrough',
  'release-announcement',
  'technical-explainer',
  'comparison',
  'social-pack',
])
/** One of {@link canvasRecipeSchema}. */
export type CanvasRecipe = z.infer<typeof canvasRecipeSchema>

/** What a recipe is for, in the order the template gallery groups them. */
export const recipeOutcomeSchema = z.enum([
  'announce',
  'launch',
  'explain',
  'compare',
  'distribute',
])
/** One of {@link recipeOutcomeSchema}. */
export type RecipeOutcome = z.infer<typeof recipeOutcomeSchema>

/** Gallery copy and requirements for each recipe. */
export const CANVAS_RECIPES: Record<
  CanvasRecipe,
  {
    name: string
    description: string
    outcome: RecipeOutcome
    screenshots: number
    artboards: string
  }
> = {
  'feature-announcement': {
    name: 'Feature announcement',
    description:
      'Headline, a real product screenshot in a browser frame, and the value in one line.',
    outcome: 'announce',
    screenshots: 1,
    artboards: '1 artboard · 16:9',
  },
  'release-announcement': {
    name: 'Release announcement',
    description: 'What shipped in a release, quoted from its record, with its screenshot.',
    outcome: 'announce',
    screenshots: 0,
    artboards: '1 artboard · 16:9',
  },
  'product-launch': {
    name: 'Product launch',
    description: 'Problem, product, features, benefits and call to action as a sequence.',
    outcome: 'launch',
    screenshots: 1,
    artboards: '5 artboards · 16:9',
  },
  walkthrough: {
    name: 'Feature walkthrough',
    description: 'Numbered steps, one screenshot each, with short explanatory copy.',
    outcome: 'explain',
    screenshots: 1,
    artboards: '1 artboard per step · 4:5',
  },
  'technical-explainer': {
    name: 'Technical explanation',
    description: 'A code window, a terminal and a structured flow diagram you can edit.',
    outcome: 'explain',
    screenshots: 0,
    artboards: '1 artboard · 16:9',
  },
  'before-after': {
    name: 'Before and after',
    description: 'Two product states side by side, labelled.',
    outcome: 'compare',
    screenshots: 2,
    artboards: '1 artboard · 16:9',
  },
  comparison: {
    name: 'Comparison table',
    description: 'A structured table. Every claim stays a placeholder until you add a sourced one.',
    outcome: 'compare',
    screenshots: 0,
    artboards: '1 artboard · 16:9',
  },
  'social-pack': {
    name: 'Social pack',
    description: 'One message adapted to 16:9, 1:1, 4:5 and 9:16.',
    outcome: 'distribute',
    screenshots: 1,
    artboards: '4 artboards',
  },
}

/** Recipes write `x.y` versions so a template change never rewrites saved artboards. */
export const RECIPE_VERSION = 1

const INK = '#141a17'
const MUTED = '#55625c'
const ACCENT = '#1f6feb'
const PAPER = '#f4f6f5'

type Placed = { document: DesignDocument; name: string; provenance: LayerProvenance[] }
type Text = DesignDocument['texts'][number]
const textLayerSchema = designDocumentSchema.shape.texts.unwrap().element
const overlaySchema = designDocumentSchema.shape.overlays.unwrap().element
const screenLayerSchema = designDocumentSchema.shape.devices.unwrap().shape.mockups.unwrap().element

/** IDs are passed in so a recipe is deterministic under test. */
export type NewId = () => string

function claim(layerId: string, generated: string, reference?: EvidenceReference): LayerProvenance {
  return {
    layerId,
    generated: generated.slice(0, 300),
    status: reference ? 'verified' : 'suggested',
    ...(reference ? { reference } : {}),
  }
}

function text(
  id: string,
  value: string,
  options: Partial<Text> & Pick<Text, 'fontSize' | 'position'>
): Text {
  return textLayerSchema.parse({
    id,
    text: value.slice(0, 300) || ' ',
    color: INK,
    fontFamily: 'inter',
    fontWeight: 'bold',
    fit: 'wrap',
    align: 'center',
    maxWidth: 0.8,
    lineHeight: 1.15,
    ...options,
  })
}

/** The headline and supporting line a recipe uses, and where each came from. */
function copyFor(input: z.output<typeof recipeInputSchema>) {
  const release = input.release
  const feature =
    release && input.featureIndex !== undefined ? release.features[input.featureIndex] : undefined
  const headlineReference: EvidenceReference | undefined = feature
    ? {
        kind: 'release-feature',
        id: release!.id,
        label: feature.title,
        ...(feature.url ? { url: feature.url } : {}),
      }
    : release
      ? {
          kind: 'release',
          id: release.id,
          label: release.title,
          ...(release.url ? { url: release.url } : {}),
        }
      : undefined
  const headline =
    input.headline || feature?.title || release?.title || 'Name the feature you shipped'
  const supportingReference: EvidenceReference | undefined =
    !input.supporting && release?.benefitStatement
      ? { kind: 'release', id: release.id, label: release.title }
      : undefined
  const supporting =
    input.supporting ||
    release?.benefitStatement ||
    'Say what it lets your customer do, in one line.'
  return {
    headline,
    supporting,
    // A person's own words need no provenance; generated words always get some.
    headlineClaim: input.headline ? null : (headlineReference ?? null),
    supportingClaim: input.supporting ? null : (supportingReference ?? null),
    generatedHeadline: !input.headline,
    generatedSupporting: !input.supporting,
  }
}

/** A Story Set treatment as a single native document: the Story Set's own composition code. */
function treatment(
  input: z.output<typeof recipeInputSchema>,
  format: StoryFormat,
  kind: Treatment,
  newId: NewId,
  screenshot: RecipeScreenshot
): Placed {
  const copy = copyFor(input)
  const story: Story = {
    id: newId(),
    headline: copy.headline,
    supporting: copy.supporting,
    source: {
      id: newId(),
      revision: 1,
      ...screenshot,
      src: screenshot.src as Story['source']['src'],
    },
    focus: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
  }
  const output = composeOutput(story, format, kind, newId())
  const provenance: LayerProvenance[] = []
  if (copy.generatedHeadline)
    provenance.push(claim(output.bindings.headline, copy.headline, copy.headlineClaim ?? undefined))
  if (copy.generatedSupporting)
    provenance.push(
      claim(output.bindings.supporting, copy.supporting, copy.supportingClaim ?? undefined)
    )
  return { document: output.document, name: copy.headline, provenance }
}

/** A text-led card: optional eyebrow label, headline and supporting line. */
function textCard(
  size: { width: number; height: number },
  newId: NewId,
  content: { eyebrow?: string; headline: string; supporting?: string; background?: string }
): { document: DesignDocument; ids: { eyebrow?: string; headline: string; supporting?: string } } {
  const document = sizedDesignDocument(size, content.background ?? PAPER)
  const ids = {
    headline: newId(),
    ...(content.eyebrow ? { eyebrow: newId() } : {}),
    ...(content.supporting ? { supporting: newId() } : {}),
  }
  const portrait = size.height > size.width
  if (content.eyebrow)
    document.texts.push(
      text(ids.eyebrow!, content.eyebrow, {
        role: 'label',
        fontSize: portrait ? 0.03 : 0.018,
        color: ACCENT,
        letterSpacing: 0.08,
        position: { x: 50, y: 30 },
      })
    )
  document.texts.push(
    text(ids.headline, content.headline, {
      role: 'headline',
      fontSize: portrait ? 0.075 : 0.055,
      position: { x: 50, y: content.eyebrow ? 44 : 40 },
    })
  )
  if (content.supporting)
    document.texts.push(
      text(ids.supporting!, content.supporting, {
        role: 'body',
        fontSize: portrait ? 0.034 : 0.022,
        fontWeight: 'normal',
        color: MUTED,
        maxWidth: 0.7,
        lineHeight: 1.4,
        position: { x: 50, y: 62 },
      })
    )
  return { document, ids }
}

/** A window that shows code, with a terminal-style variant. */
function codeScreen(
  id: string,
  code: string,
  options: { terminal?: boolean; x: number; y: number; size: number; title: string; aspect: number }
) {
  return screenLayerSchema.parse({
    id,
    definitionId: 'iphone-17-pro-front',
    frame: {
      kind: 'window',
      chrome: {
        ...DEFAULT_FRAME_CHROME,
        title: options.title,
        window: options.terminal ? 'terminal-macos' : 'macos',
        appearance: 'dark',
      },
    },
    position: { x: options.x, y: options.y },
    size: options.size,
    screen: {
      aspect: options.aspect,
      fit: 'cover',
      src: null,
      code: {
        ...createCodeContent(code),
        language: options.terminal ? 'shell-session' : 'typescript',
        lineNumbers: !options.terminal,
      },
    },
  })
}

function browserScreen(
  id: string,
  shot: RecipeScreenshot,
  at: { x: number; y: number; size: number }
) {
  return screenLayerSchema.parse({
    id,
    definitionId: 'iphone-17-pro-front',
    frame: { kind: 'browser', chrome: { ...DEFAULT_FRAME_CHROME, address: '' } },
    position: { x: at.x, y: at.y },
    size: at.size,
    screen: { aspect: shot.width / shot.height, fit: 'contain', src: shot.src, name: shot.name },
  })
}

const SAMPLE_CODE = `import { Studio } from '@acme/sdk'

const studio = new Studio({ apiKey: process.env.ACME_KEY })
const shot = await studio.capture('https://example.com')
console.log(shot.url)`

const SAMPLE_TERMINAL = `$ npm install @acme/sdk
added 1 package in 2s
$ npx acme capture https://example.com
✔ Saved shot.png`

function rect(
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  fill: string,
  stroke = fill,
  width = 2
) {
  return {
    id,
    type: 'rectangle' as const,
    start: from,
    end: to,
    fillColor: fill,
    strokeColor: stroke,
    strokeWidth: width,
    opacity: 1,
  }
}

function arrow(
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color = INK
) {
  return {
    id,
    type: 'arrow' as const,
    start: from,
    end: to,
    strokeColor: color,
    strokeWidth: 4,
    fillColor: 'transparent',
    opacity: 1,
  }
}

/** A labelled three-step flow: boxes, arrows and labels, all native and editable. */
function flowDiagram(
  document: DesignDocument,
  newId: NewId,
  fill: FillImage,
  labels: readonly string[],
  area: { left: number; top: number; width: number; height: number }
) {
  const size = documentCanvasSize(document)
  const count = labels.length
  const gap = area.width * 0.08
  const box = (area.width - gap * (count - 1)) / count
  labels.forEach((label, index) => {
    const left = area.left + index * (box + gap)
    document.overlays.push(
      overlaySchema.parse(
        container(newId(), fill, size.width / size.height, {
          cx: left + box / 2,
          cy: area.top + area.height / 2,
          width: box,
          height: area.height,
          color: '#ffffff',
        })
      )
    )
    document.texts.push(
      text(newId(), label, {
        role: 'label',
        fontSize: 0.016,
        maxWidth: box * 0.9,
        position: { x: (left + box / 2) * 100, y: (area.top + area.height / 2) * 100 },
      })
    )
    if (index < count - 1)
      document.annotations.push(
        arrow(
          newId(),
          { x: left + box + gap * 0.15, y: area.top + area.height / 2 },
          { x: left + box + gap * 0.85, y: area.top + area.height / 2 }
        )
      )
  })
}

function build(recipe: CanvasRecipe, raw: RecipeInput, newId: NewId, fill: FillImage): Placed[] {
  const input = recipeInputSchema.parse(raw)
  const [first, second] = input.screenshots
  const copy = copyFor(input)
  const wide = ARTBOARD_PRESETS['wide-16x9']
  switch (recipe) {
    case 'feature-announcement': {
      if (first) return [treatment(input, 'wide', 'editorial-split', newId, first)]
      const card = textCard(wide, newId, {
        eyebrow: 'New',
        headline: copy.headline,
        supporting: copy.supporting,
      })
      return [
        {
          document: card.document,
          name: copy.headline,
          provenance: [
            claim(card.ids.eyebrow!, 'New'),
            ...(copy.generatedHeadline
              ? [claim(card.ids.headline, copy.headline, copy.headlineClaim ?? undefined)]
              : []),
            ...(copy.generatedSupporting
              ? [claim(card.ids.supporting!, copy.supporting, copy.supportingClaim ?? undefined)]
              : []),
          ],
        },
      ]
    }
    case 'release-announcement': {
      const release = input.release
      const features = release?.features.slice(0, 4) ?? []
      const document = sizedDesignDocument(wide, PAPER)
      const provenance: LayerProvenance[] = []
      const headlineId = newId()
      const headline = release ? release.title : 'Name the release'
      document.texts.push(
        text(headlineId, headline, {
          role: 'headline',
          fontSize: 0.042,
          align: 'left',
          maxWidth: 0.42,
          position: { x: 27, y: 20 },
        })
      )
      provenance.push(
        claim(
          headlineId,
          headline,
          release ? { kind: 'release', id: release.id, label: release.title } : undefined
        )
      )
      const list = features.length
        ? features.map((feature) => feature.title)
        : ['List what shipped, from the release notes']
      list.forEach((item, index) => {
        const id = newId()
        const badge = createElement('badge', {
          aspect: wide.width / wide.height,
          id: newId(),
          x: 0.075,
          y: 0.4 + index * 0.13,
          number: index + 1,
        })
        document.elements.push(badge)
        document.texts.push(
          text(id, item, {
            role: 'body',
            fontSize: 0.02,
            fontWeight: '600',
            align: 'left',
            maxWidth: 0.36,
            position: { x: 28.5, y: 40 + index * 13 },
          })
        )
        provenance.push(
          claim(
            id,
            item,
            release && features[index]
              ? { kind: 'release-feature', id: release.id, label: features[index].title }
              : undefined
          )
        )
      })
      const shot = first
      if (shot) {
        document.mode = 'device'
        document.devices = {
          mockups: [browserScreen(newId(), shot, { x: 0.74, y: 0.52, size: 0.44 })],
        }
      }
      return [{ document: designDocumentSchema.parse(document), name: headline, provenance }]
    }
    case 'product-launch': {
      const slides: Placed[] = []
      const problem = textCard(wide, newId, {
        eyebrow: 'The problem',
        headline: 'Describe the problem your customer has today',
        supporting: 'Use their words. Keep it to one sentence.',
      })
      slides.push({
        document: problem.document,
        name: 'Problem',
        provenance: [
          claim(problem.ids.eyebrow!, 'The problem'),
          claim(problem.ids.headline, 'Describe the problem your customer has today'),
          claim(problem.ids.supporting!, 'Use their words. Keep it to one sentence.'),
        ],
      })
      slides.push(
        first
          ? { ...treatment(input, 'wide', 'product-hero', newId, first), name: 'Product' }
          : { ...build('feature-announcement', raw, newId, fill)[0]!, name: 'Product' }
      )
      const featureDoc = sizedDesignDocument(wide, PAPER)
      const featureClaims: LayerProvenance[] = []
      const featureTitles =
        input.release?.features.slice(0, 3).map((feature) => feature.title) ?? []
      const titles = featureTitles.length
        ? featureTitles
        : ['First feature', 'Second feature', 'Third feature']
      const headId = newId()
      featureDoc.texts.push(
        text(headId, 'What you can do now', {
          role: 'headline',
          fontSize: 0.04,
          position: { x: 50, y: 16 },
        })
      )
      featureClaims.push(claim(headId, 'What you can do now'))
      titles.forEach((title, index) => {
        const left = 0.08 + index * 0.29
        featureDoc.overlays.push(
          overlaySchema.parse(
            container(newId(), fill, wide.width / wide.height, {
              cx: left + 0.13,
              cy: 0.56,
              width: 0.26,
              height: 0.48,
              color: '#ffffff',
            })
          )
        )
        const id = newId()
        featureDoc.texts.push(
          text(id, title, {
            role: 'subheadline',
            fontSize: 0.02,
            maxWidth: 0.22,
            position: { x: (left + 0.13) * 100, y: 50 },
          })
        )
        featureClaims.push(
          claim(
            id,
            title,
            featureTitles[index] && input.release
              ? { kind: 'release-feature', id: input.release.id, label: title }
              : undefined
          )
        )
      })
      slides.push({ document: featureDoc, name: 'Features', provenance: featureClaims })
      const benefit = textCard(wide, newId, {
        eyebrow: 'Why it matters',
        headline: copy.supporting,
        background: '#eef3ff',
      })
      slides.push({
        document: benefit.document,
        name: 'Benefit',
        provenance: [
          claim(benefit.ids.eyebrow!, 'Why it matters'),
          ...(copy.generatedSupporting
            ? [claim(benefit.ids.headline, copy.supporting, copy.supportingClaim ?? undefined)]
            : []),
        ],
      })
      const cta = textCard(wide, newId, {
        headline: 'Try it today',
        supporting: 'Add your link or install command',
        background: INK,
      })
      cta.document.texts.forEach((layer) => {
        layer.color = layer.id === cta.ids.headline ? '#ffffff' : '#c7d0cc'
      })
      slides.push({
        document: cta.document,
        name: 'Call to action',
        provenance: [
          claim(cta.ids.headline, 'Try it today'),
          claim(cta.ids.supporting!, 'Add your link or install command'),
        ],
      })
      return slides
    }
    case 'walkthrough': {
      const portrait = ARTBOARD_PRESETS['portrait-4x5']
      const steps = input.steps.length
        ? input.steps
        : ['Open the feature', 'Make the change', 'See the result']
      return steps.map((step, index) => {
        const shot = input.screenshots[index] ?? first
        const document = sizedDesignDocument(portrait, PAPER)
        const badge = createElement('badge', {
          aspect: portrait.width / portrait.height,
          id: newId(),
          x: 0.12,
          y: 0.1,
          number: index + 1,
        })
        document.elements.push(badge)
        const stepId = newId()
        document.texts.push(
          text(stepId, step, {
            role: 'headline',
            fontSize: 0.058,
            align: 'left',
            maxWidth: 0.7,
            position: { x: 54, y: 10 },
          })
        )
        if (shot) {
          document.mode = 'device'
          document.devices = {
            mockups: [browserScreen(newId(), shot, { x: 0.5, y: 0.58, size: 0.86 })],
          }
        }
        return {
          document: designDocumentSchema.parse(document),
          name: `Step ${index + 1}`,
          provenance: input.steps.length ? [] : [claim(stepId, step)],
        }
      })
    }
    case 'technical-explainer': {
      const document = sizedDesignDocument(wide, '#0f1512')
      const headId = newId()
      const headline = copy.headline
      document.texts.push(
        text(headId, headline, {
          role: 'headline',
          fontSize: 0.034,
          color: '#f2f5f3',
          align: 'left',
          maxWidth: 0.5,
          position: { x: 30, y: 11 },
        })
      )
      document.mode = 'device'
      document.devices = {
        mockups: [
          codeScreen(newId(), input.code || SAMPLE_CODE, {
            x: 0.3,
            y: 0.47,
            size: 0.5,
            title: 'index.ts',
            aspect: 1.7,
          }),
          codeScreen(newId(), SAMPLE_TERMINAL, {
            terminal: true,
            x: 0.76,
            y: 0.42,
            size: 0.38,
            title: 'zsh',
            aspect: 1.6,
          }),
        ],
      }
      flowDiagram(document, newId, fill, ['Your app', 'API', 'Result'], {
        left: 0.55,
        top: 0.72,
        width: 0.4,
        height: 0.12,
      })
      for (const layer of document.texts.slice(1)) layer.color = INK
      return [
        {
          document: designDocumentSchema.parse(document),
          name: 'Technical explanation',
          provenance: copy.generatedHeadline
            ? [claim(headId, headline, copy.headlineClaim ?? undefined)]
            : [],
        },
      ]
    }
    case 'before-after': {
      const document = sizedDesignDocument(wide, PAPER)
      const provenance: LayerProvenance[] = []
      const headId = newId()
      document.texts.push(
        text(headId, copy.headline, {
          role: 'headline',
          fontSize: 0.036,
          position: { x: 50, y: 11 },
        })
      )
      if (copy.generatedHeadline)
        provenance.push(claim(headId, copy.headline, copy.headlineClaim ?? undefined))
      for (const [index, label] of ['Before', 'After'].entries()) {
        const id = newId()
        document.texts.push(
          text(id, label, {
            role: 'label',
            fontSize: 0.018,
            color: index ? ACCENT : MUTED,
            letterSpacing: 0.08,
            position: { x: index ? 74 : 26, y: 24 },
          })
        )
      }
      const screens = [first, second].flatMap((shot, index) =>
        shot ? [browserScreen(newId(), shot, { x: index ? 0.74 : 0.26, y: 0.6, size: 0.44 })] : []
      )
      if (screens.length) {
        document.mode = 'device'
        document.devices = { mockups: screens }
      } else {
        for (const left of [0.04, 0.52])
          document.annotations.push(
            rect(newId(), { x: left, y: 0.3 }, { x: left + 0.44, y: 0.9 }, '#ffffff', '#c9d3ce')
          )
      }
      return [
        { document: designDocumentSchema.parse(document), name: 'Before and after', provenance },
      ]
    }
    case 'comparison': {
      const document = sizedDesignDocument(wide, '#ffffff')
      const provenance: LayerProvenance[] = []
      const headId = newId()
      document.texts.push(
        text(headId, copy.headline, {
          role: 'headline',
          fontSize: 0.034,
          position: { x: 50, y: 10 },
        })
      )
      if (copy.generatedHeadline)
        provenance.push(claim(headId, copy.headline, copy.headlineClaim ?? undefined))
      const columns = [0.3, 0.6, 0.85]
      const rows = [0.32, 0.47, 0.62, 0.77]
      const headers = ['', 'Your product', 'Alternative']
      headers.forEach((label, index) => {
        if (!label) return
        document.texts.push(
          text(newId(), label, {
            role: 'label',
            fontSize: 0.017,
            position: { x: columns[index]! * 100, y: 22 },
          })
        )
      })
      rows.forEach((y, row) => {
        document.annotations.push({
          id: newId(),
          type: 'line',
          start: { x: 0.08, y: y - 0.075 },
          end: { x: 0.95, y: y - 0.075 },
          strokeColor: '#dfe5e2',
          strokeWidth: 2,
          fillColor: 'transparent',
          opacity: 1,
        })
        const cells = [`Capability ${row + 1}`, 'Add a sourced claim', 'Add a sourced claim']
        cells.forEach((value, column) => {
          const id = newId()
          document.texts.push(
            text(id, value, {
              role: column ? 'body' : 'subheadline',
              fontSize: 0.015,
              fontWeight: column ? 'normal' : '600',
              color: column ? MUTED : INK,
              maxWidth: 0.22,
              position: { x: columns[column]! * 100, y: y * 100 },
            })
          )
          provenance.push(claim(id, value))
        })
      })
      return [{ document: designDocumentSchema.parse(document), name: 'Comparison', provenance }]
    }
    case 'social-pack': {
      if (!first) {
        return Object.values(ARTBOARD_PRESETS)
          .filter((preset) =>
            ['1600x900', '1080x1080', '1080x1350', '1080x1920'].includes(
              `${preset.width}x${preset.height}`
            )
          )
          .map((preset) => {
            const card = textCard(preset, newId, {
              headline: copy.headline,
              supporting: copy.supporting,
            })
            return {
              document: card.document,
              name: preset.name.split(' · ')[0]!,
              provenance: [
                ...(copy.generatedHeadline
                  ? [claim(card.ids.headline, copy.headline, copy.headlineClaim ?? undefined)]
                  : []),
                ...(copy.generatedSupporting
                  ? [
                      claim(
                        card.ids.supporting!,
                        copy.supporting,
                        copy.supportingClaim ?? undefined
                      ),
                    ]
                  : []),
              ],
            }
          })
      }
      const formats: [StoryFormat, string][] = [
        ['wide', '16:9'],
        ['square', '1:1'],
        ['portrait', '4:5'],
      ]
      const placed = formats.map(([format, name]) => ({
        ...treatment(input, format, 'product-hero', newId, first),
        name,
      }))
      const story = placed[2]!
      // 9:16 starts from the 4:5 composition laid out again for the taller format.
      placed.push({
        ...story,
        name: '9:16',
        document: adaptDocumentToSize(story.document, ARTBOARD_PRESETS['story-9x16'], {
          imageAspect: first.width / first.height,
        }),
      })
      return placed
    }
  }
}

/**
 * Artboards for a recipe, placed left to right from `origin` with the
 * standard gap. Every artboard records the recipe and version it came from.
 */
export function buildRecipe(
  recipe: CanvasRecipe,
  input: RecipeInput,
  {
    origin = { x: 0, y: 0 },
    newId = () => crypto.randomUUID(),
    fill = solidFill,
  }: { origin?: { x: number; y: number }; newId?: NewId; fill?: FillImage } = {}
): Artboard[] {
  let x = origin.x
  return build(recipe, input, newId, fill).map((placed) => {
    const artboard = artboardSchema.parse({
      id: newId(),
      name: placed.name.slice(0, 120),
      x,
      y: origin.y,
      document: placed.document,
      origin: { kind: 'recipe', id: recipe, version: RECIPE_VERSION },
      provenance: placed.provenance,
      ...(input.release ? { context: { releaseId: input.release.id } } : {}),
    })
    x += (placed.document.canvas?.size?.width ?? 1600) + ARTBOARD_GAP
    return artboard
  })
}

/** A blank artboard at a preset size, with one headline so it is never an empty stage. */
export function blankArtboard(
  preset: ArtboardPreset | { width: number; height: number },
  {
    x,
    y,
    newId = () => crypto.randomUUID(),
    name,
  }: { x: number; y: number; newId?: NewId; name?: string }
): Artboard {
  const size = typeof preset === 'string' ? ARTBOARD_PRESETS[preset] : preset
  const document = sizedDesignDocument(size, '#ffffff')
  document.texts.push(
    text(newId(), 'Add a headline', {
      role: 'headline',
      fontSize: size.height > size.width ? 0.07 : 0.05,
      position: { x: 50, y: 45 },
    })
  )
  return artboardSchema.parse({
    id: newId(),
    name:
      name ??
      (typeof preset === 'string'
        ? ARTBOARD_PRESETS[preset].name.split(' · ')[0]
        : `${size.width} × ${size.height}`),
    x,
    y,
    document,
  })
}

/** The Story Set format closest to an artboard's shape. */
function nearestFormat(size: { width: number; height: number }): StoryFormat {
  const aspect = size.width / size.height
  return aspect > 1.2 ? 'wide' : aspect < 0.9 ? 'portrait' : 'square'
}

/**
 * Other arrangements of an artboard's screenshot and copy, as new artboards.
 * Regeneration never overwrites: the original stays exactly as it is, and a
 * generated line keeps its claim status in every alternative.
 */
export function alternativeLayouts(
  source: Artboard,
  screenshot: RecipeScreenshot,
  { newId = () => crypto.randomUUID() }: { newId?: NewId } = {}
): Artboard[] {
  const texts = source.document.texts.filter((text) => text.visible !== false)
  const headline = texts.find((text) => text.role === 'headline') ?? texts[0]
  const supporting = texts.find(
    (text) => text !== headline && (text.role === 'body' || text.role === 'subheadline')
  )
  const format = nearestFormat(documentCanvasSize(source.document))
  const claimOf = (layer: Text | undefined) =>
    layer
      ? source.provenance.find(
          (claim) => claim.layerId === layer.id && claim.generated === layer.text
        )
      : undefined
  let x = source.x
  return (['product-hero', 'editorial-split', 'detail-spotlight', 'product-closeup'] as const).map(
    (kind) => {
      const placed = treatment(
        { headline: headline?.text, supporting: supporting?.text, screenshots: [], steps: [] },
        format,
        kind,
        newId,
        screenshot
      )
      const bindings = placed.document.texts.map((text) => text.id!)
      const provenance = [claimOf(headline), claimOf(supporting)].flatMap((claim, index) =>
        claim && bindings[index] ? [{ ...claim, layerId: bindings[index]! }] : []
      )
      const at = x
      x += documentCanvasSize(placed.document).width + ARTBOARD_GAP
      return artboardSchema.parse({
        id: newId(),
        name: `${source.name.slice(0, 90)} · ${kind.replaceAll('-', ' ')}`,
        x: at,
        y: source.y,
        document: placed.document,
        origin: { kind: 'recipe', id: 'feature-announcement', version: RECIPE_VERSION },
        provenance,
        ...(source.context ? { context: source.context } : {}),
      })
    }
  )
}
