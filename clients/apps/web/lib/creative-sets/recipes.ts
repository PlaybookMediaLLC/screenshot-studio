import { designDocumentSchema } from '@/lib/design/document'
import { createElement } from '@/lib/editor/elements/schema'
import { screenshotBox } from '@/lib/export/adapt'
import { resolveFocus } from './focus'
import {
  creativeSetDocumentSchema,
  STORY_FORMATS,
  type CreativeOutput,
  type CreativeSetDocument,
  type StoryFormat,
  type StorySource,
  type FocusRegion,
  type Treatment,
  type Story,
} from './document'

/** Authored arrangements, in native units: text percentages; image/element fractions. */
export function composeOutput(
  story: Story,
  format: StoryFormat,
  treatment: Treatment,
  outputId: string
): CreativeOutput {
  const wide = format === 'wide'
  const portrait = format === 'portrait'
  const split = treatment === 'editorial-split'
  const detail = treatment === 'detail-spotlight'
  const closeup = treatment === 'product-closeup'
  const side = wide && (split || detail)
  const bindings = {
    headline: `${outputId}-headline`,
    supporting: `${outputId}-supporting`,
    focus: `${outputId}-focus`,
  }
  const size = STORY_FORMATS[format]
  const callout = createElement('callout', { aspect: size.width / size.height, id: bindings.focus })
  if (callout.type === 'callout') {
    callout.x = closeup ? 0.5 : wide ? 0.72 : 0.56
    callout.y = closeup ? 0.5 : wide ? 0.77 : 0.78
    callout.width = closeup ? 0.91 : wide ? 0.4 : 0.72
    const focusAspect =
      (story.source.width * story.focus.width) / (story.source.height * story.focus.height)
    callout.height = Math.min(
      0.28,
      Math.max(0.14, (callout.width * size.width) / focusAspect / size.height)
    )
    if (closeup) {
      callout.height = Math.min(0.88, (callout.width * size.width) / focusAspect / size.height)
      callout.props.radius = 0.025
      callout.props.connector = false
      callout.props.showSource = false
    }
    callout.props.borderColor = '#ffffff'
    callout.props.borderWidth = closeup ? 0 : 2
    callout.props.shadow = {
      enabled: true,
      blur: 18,
      color: 'rgba(24,37,32,0.16)',
      offsetX: 0,
      offsetY: 6,
    }
  }
  const document = designDocumentSchema.parse({
    version: 2,
    canvas: {
      aspectRatio: 'custom',
      size: { width: size.width, height: size.height },
      padding: 40,
    },
    background: closeup
      ? { type: 'gradient', value: 'linear-gradient(135deg, #187cf5 0%, #23b4e8 100%)', radius: 24 }
      : { type: 'solid', value: split ? '#eeeae3' : '#f3f5f4', radius: 0 },
    mode: closeup ? 'screenshot' : 'browser',
    image: {
      src: story.source.src,
      name: story.source.name,
      scale: 100,
      opacity: closeup ? 0 : 1,
      offset: {
        x: side ? 0.22 : detail ? -0.04 : 0,
        y: side ? -0.02 : detail ? 0.06 : 0.15,
      },
      radius: 12,
      frame: { type: closeup ? 'none' : 'browser', title: '', color: '#ffffff' },
      chrome: { appearance: 'light', address: '', tabs: [] },
      shadow: {
        custom: {
          enabled: !closeup,
          blur: 24,
          color: '#182520',
          opacity: 0.14,
          offsetX: 0,
          offsetY: 8,
          spread: 0,
        },
      },
    },
    texts: [
      {
        id: bindings.headline,
        text: story.headline,
        visible: !closeup,
        role: 'headline',
        fit: 'wrap',
        color: '#182520',
        fontFamily: 'inter',
        fontSize: side ? 0.048 : portrait ? 0.067 : 0.055,
        fontWeight: 'bold',
        align: side ? 'left' : 'center',
        maxWidth: side ? 0.35 : 0.82,
        lineHeight: 1.12,
        position: { x: side ? 24 : 50, y: side ? 35 : 14 },
      },
      {
        id: bindings.supporting,
        text: story.supporting || ' ',
        visible: !closeup && Boolean(story.supporting),
        role: 'body',
        fit: 'wrap',
        color: '#506059',
        fontSize: side ? 0.018 : 0.025,
        fontWeight: 'normal',
        align: side ? 'left' : 'center',
        maxWidth: side ? 0.35 : 0.74,
        lineHeight: 1.4,
        position: { x: side ? 24 : 50, y: side ? 62 : 28 },
      },
    ],
    elements: detail || closeup ? [callout] : [],
  })
  const image = screenshotBox(document, size, story.source.width / story.source.height)
  if (image) {
    const target = side
      ? { width: 0.48, height: detail ? 0.5 : 0.72 }
      : { width: detail ? 0.72 : 0.84, height: detail ? 0.4 : 0.54 }
    // The native frame scales both its fitted image and its outer group.
    document.image.scale = Math.min(
      200,
      100 * Math.sqrt(Math.min(target.width / image.width, target.height / image.height))
    )
  }
  const proof = document.elements.find((element) => element.id === bindings.focus)
  if (proof?.type === 'callout') resolveFocus(document, story.source, story.focus, proof)
  return {
    id: outputId,
    storyId: story.id,
    kind: 'design',
    reusable: [],
    format,
    composition: { id: treatment, version: 2 },
    bindings,
    overrides: { headline: closeup, supporting: closeup, source: false, focus: false },
    review: { source: false, redactions: false, wording: false },
    document,
  }
}

export function createCreativeSet(
  input: {
    headline: string
    supporting: string
    source: StorySource
    focus: FocusRegion
    treatment: Treatment
  },
  newId = () => crypto.randomUUID()
): CreativeSetDocument {
  const story = {
    id: newId(),
    headline: input.headline,
    supporting: input.supporting,
    source: input.source,
    focus: input.focus,
  }
  return creativeSetDocumentSchema.parse({
    version: 2,
    stories: [story],
    brand: null,
    deliveries: [],
    outputs: (Object.keys(STORY_FORMATS) as StoryFormat[]).map((format) =>
      composeOutput(story, format, input.treatment, newId())
    ),
  })
}
