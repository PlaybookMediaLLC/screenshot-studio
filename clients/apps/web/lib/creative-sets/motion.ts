import { z } from 'zod'
import { designDocumentSchema } from '@/lib/design/document'
import { type KeyframeTrack, type MotionTarget } from '@/lib/animation/motion-schema'
import { creativeSetDocumentSchema, type CreativeSetDocument } from './document'

export const storyMotionSchema = z.enum(['proof-reveal', 'gentle-pan', 'clean-entrance', 'none'])
export const STORY_MOTION = {
  'proof-reveal': 'Proof reveal',
  'gentle-pan': 'Gentle pan',
  'clean-entrance': 'Clean entrance',
  none: 'Remove story motion',
}

/** Authored motion adds ordinary editable native tracks without erasing unrelated animation or audio. */
export function applyStoryMotion(
  set: CreativeSetDocument,
  outputId: string,
  input: z.infer<typeof storyMotionSchema>
) {
  const treatment = storyMotionSchema.parse(input)
  const next = structuredClone(set)
  const output = next.outputs.find((output) => output.id === outputId)
  if (!output) throw new Error('This format no longer exists.')
  const timeline = output.document.timeline ?? {
    clips: [],
    tracks: [],
    duration: 4000,
    isLooping: false,
  }
  const tracks = (timeline.layerTracks ?? []).filter(
    (track) => !track.id.startsWith('story-motion:')
  )
  const add = (
    name: string,
    target: MotionTarget,
    property: KeyframeTrack['property'],
    from: number,
    to: number,
    start: number,
    end: number
  ) => {
    if (
      tracks.some(
        (track) =>
          track.property === property && JSON.stringify(track.target) === JSON.stringify(target)
      )
    )
      throw new Error(
        `This layer already has a custom ${property} animation. Edit it in the timeline before applying this motion treatment.`
      )
    const id = `story-motion:${name}`
    tracks.push({
      id,
      target,
      property,
      keyframes: [
        { id: `${id}:start`, time: start, value: from, easing: 'ease-out-cubic' },
        { id: `${id}:end`, time: end, value: to, easing: 'ease-out-cubic' },
      ],
    })
  }
  if (treatment === 'gentle-pan') {
    add('image-pan', { kind: 'image' }, 'x', -0.012, 0.012, 0, 4000)
    add('image-scale', { kind: 'image' }, 'scale', 1, 1.025, 0, 4000)
  } else if (treatment !== 'none') {
    add('headline-fade', { kind: 'text', id: output.bindings.headline }, 'opacity', 0, 1, 0, 550)
    add('image-fade', { kind: 'image' }, 'opacity', 0, 1, 300, 900)
    if (treatment === 'clean-entrance') {
      add('headline-rise', { kind: 'text', id: output.bindings.headline }, 'y', 0.015, 0, 0, 550)
      add('image-rise', { kind: 'image' }, 'y', 0.025, 0, 300, 900)
    }
    if (output.document.elements.some((layer) => layer.id === output.bindings.focus)) {
      add('proof-fade', { kind: 'element', id: output.bindings.focus }, 'opacity', 0, 1, 900, 1450)
      add('proof-scale', { kind: 'element', id: output.bindings.focus }, 'scale', 0.9, 1, 900, 1450)
    }
  }
  output.document = designDocumentSchema.parse({
    ...output.document,
    timeline: { ...timeline, duration: Math.max(timeline.duration, 4000), layerTracks: tracks },
  })
  return creativeSetDocumentSchema.parse(next)
}
