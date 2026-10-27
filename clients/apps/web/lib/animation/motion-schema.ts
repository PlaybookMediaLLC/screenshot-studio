import { z } from 'zod'
import { fontFamilies } from '@/lib/constants/fonts'

/**
 * Motion on the timeline beyond the main image's preset clips: keyframed
 * properties on any layer, text reveals, scroll-through, audio, and
 * captions. These schemas extend the DesignDocument `timeline` section, so a
 * design carries its motion in normalized units (milliseconds, canvas
 * fractions) and plays the same in the editor, previews, and every export.
 *
 * Playback never writes into these values: the canvas evaluates them at the
 * playhead (see `motion-evaluate.ts`).
 */

/** Milliseconds on the timeline or in a source, up to the timeline's 10 minute limit. */
const ms = z.number().min(0).max(600_000)
const unit = z.number().min(0).max(1)
const motionId = z.string().min(1).max(80)
const color = z
  .string()
  .regex(/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/i, 'Use a #hex or rgb() color.')

/** The named easings every motion shares with the preset clips. */
export const easingSchema = z.enum([
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'ease-in-cubic',
  'ease-out-cubic',
  'ease-in-expo',
  'ease-out-expo',
])
/** A named easing. */
export type EasingName = z.infer<typeof easingSchema>

/**
 * A custom easing, as CSS `cubic-bezier(x1, y1, x2, y2)`. The x values stay
 * in 0-1 so the curve is a function of time; y may overshoot for
 * anticipation and bounce.
 */
export const cubicBezierSchema = z.object({
  x1: unit,
  x2: unit,
  y1: z.number().min(-2).max(3),
  y2: z.number().min(-2).max(3),
})
/** Control points of a custom easing. */
export type CubicBezier = z.infer<typeof cubicBezierSchema>

/** How a motion eases: a named curve, or a custom Bézier that wins when set. */
const easingFields = {
  bezier: cubicBezierSchema.optional(),
  easing: easingSchema,
}

/** The kinds of layer that can be animated. */
export const motionTargetKindSchema = z.enum(['image', 'text', 'sticker', 'device', 'element'])
/** A kind of animatable layer. */
export type MotionTargetKind = z.infer<typeof motionTargetKindSchema>

/** The layer a motion applies to. The main image has no id; every other layer does. */
export const motionTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image') }),
  z.object({ id: motionId, kind: z.literal('text') }),
  z.object({ id: motionId, kind: z.literal('sticker') }),
  z.object({ id: motionId, kind: z.literal('device') }),
  z.object({ id: motionId, kind: z.literal('element') }),
])
/** The layer a motion applies to. */
export type MotionTarget = z.infer<typeof motionTargetSchema>

/**
 * Layer properties a keyframe track animates. `x` and `y` move the layer by a
 * fraction of the canvas, `rotation` adds degrees, `scale` and `opacity`
 * multiply the layer's own values, and the effect parameters (`dim` and
 * `feather` on spotlights, `zoom` on callouts) replace the layer's value.
 */
export const layerPropertySchema = z.enum([
  'x',
  'y',
  'scale',
  'rotation',
  'opacity',
  'dim',
  'feather',
  'zoom',
])
/** A property a keyframe track animates. */
export type LayerProperty = z.infer<typeof layerPropertySchema>

/** The values each property may take, and its resting value when nothing animates it. */
export const LAYER_PROPERTY_RANGES: Record<
  LayerProperty,
  { identity: number; max: number; min: number }
> = {
  dim: { identity: 0.6, max: 1, min: 0 },
  feather: { identity: 0.15, max: 1, min: 0 },
  opacity: { identity: 1, max: 1, min: 0 },
  rotation: { identity: 0, max: 720, min: -720 },
  scale: { identity: 1, max: 10, min: 0 },
  x: { identity: 0, max: 2, min: -2 },
  y: { identity: 0, max: 2, min: -2 },
  zoom: { identity: 2.5, max: 10, min: 1 },
}

/** One value at one time. Its easing shapes the motion arriving at it. */
export const layerKeyframeSchema = z.object({
  ...easingFields,
  id: motionId,
  /** Milliseconds from the start of the timeline. */
  time: ms,
  value: z.number().min(-720).max(720),
})
/** A keyframe on a layer property. */
export type LayerKeyframe = z.infer<typeof layerKeyframeSchema>

/** Keyframes for one property of one layer. Several tracks animate one layer together. */
export const keyframeTrackSchema = z
  .object({
    id: motionId,
    keyframes: z.array(layerKeyframeSchema).min(1).max(200),
    property: layerPropertySchema,
    target: motionTargetSchema,
  })
  .refine(
    (track) => {
      const range = LAYER_PROPERTY_RANGES[track.property]
      return track.keyframes.every(
        (keyframe) => keyframe.value >= range.min && keyframe.value <= range.max
      )
    },
    { message: 'A keyframe value is outside its property range.', path: ['keyframes'] }
  )
/** A keyframe track. */
export type KeyframeTrack = z.infer<typeof keyframeTrackSchema>

/** How a text layer appears: one character or one word at a time. */
export const revealModeSchema = z.enum(['typewriter', 'word'])
/** A text reveal mode. */
export type RevealMode = z.infer<typeof revealModeSchema>

/** A text layer revealing itself over `duration` from `start`; hidden before it starts. */
export const textRevealSchema = z.object({
  ...easingFields,
  duration: z.number().min(50).max(600_000),
  id: motionId,
  mode: revealModeSchema,
  start: ms,
  /** The text layer's id. */
  targetId: motionId,
})
/** A text reveal. */
export type TextReveal = z.infer<typeof textRevealSchema>

/** Which way content scrolls inside its viewport. */
export const scrollDirectionSchema = z.enum(['vertical', 'horizontal'])
/** A scroll direction. */
export type ScrollDirection = z.infer<typeof scrollDirectionSchema>

/** Layers whose screen can scroll: the main image (in its frame) or a device. */
export const scrollTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image') }),
  z.object({ id: motionId, kind: z.literal('device') }),
])
/** A layer whose screen scrolls. */
export type ScrollTarget = z.infer<typeof scrollTargetSchema>

/**
 * Content scrolling through a frame's viewport: the main image's frame or a
 * device screen. Positions are fractions of the scrollable range: 0 shows
 * the top (or left) edge, 1 the bottom (or right). The content travels from
 * `from` to `to`, easing into and holding at each pause, and `duration`
 * includes the holds.
 */
export const scrollMotionSchema = z
  .object({
    ...easingFields,
    direction: scrollDirectionSchema,
    duration: z.number().min(100).max(600_000),
    from: unit,
    id: motionId,
    pauses: z.array(z.object({ at: unit, hold: z.number().min(0).max(60_000) })).max(20),
    start: ms,
    target: scrollTargetSchema,
    to: unit,
    /** The main image's viewport as width / height; device screens keep their own shape. */
    viewport: z.number().min(0.25).max(4),
  })
  .refine(
    (scroll) => scroll.pauses.reduce((total, pause) => total + pause.hold, 0) < scroll.duration,
    {
      message: 'Pauses must leave time to scroll.',
      path: ['pauses'],
    }
  )
/** A scroll-through. */
export type ScrollMotion = z.infer<typeof scrollMotionSchema>

/** Audio formats the editor imports and workspaces store. */
export const audioMimeTypeSchema = z.enum([
  'audio/aac',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
])
/** An audio format. */
export type AudioMimeType = z.infer<typeof audioMimeTypeSchema>

/** The largest audio file the editor imports; workspace assets stop at 50 MB. */
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024

const AUDIO_ASSET_REF = /^asset:[0-9a-f-]{36}$/i
/** An audio file inlined as a data URL, as an autosaved draft keeps it. */
export const LOCAL_AUDIO_DATA_REF = new RegExp(
  `^data:(?:${audioMimeTypeSchema.options.map((type) => type.replace('/', '\\/')).join('|')});base64,`
)

/** True for a reference an audio clip may hold: a workspace asset or a local browser URL. */
export function isAudioSource(ref: string): boolean {
  return AUDIO_ASSET_REF.test(ref) || ref.startsWith('blob:') || LOCAL_AUDIO_DATA_REF.test(ref)
}

/**
 * An audio file on the timeline: it plays the source from `trimStart` to
 * `trimEnd` (source milliseconds), starting at `start` on the timeline.
 */
export const audioClipSchema = z
  .object({
    /** Linear gain; 1 plays the file as recorded. */
    gain: z.number().min(0).max(2),
    id: motionId,
    muted: z.boolean(),
    name: z.string().max(200),
    /** Length of the whole source file. */
    sourceDuration: z.number().min(1).max(600_000),
    src: z
      .string()
      .max(75_000_000)
      .refine(isAudioSource, 'Use asset:<id> for a workspace audio file, or a local audio URL.'),
    start: ms,
    trimEnd: ms,
    trimStart: ms,
  })
  .refine((clip) => clip.trimEnd > clip.trimStart && clip.trimEnd <= clip.sourceDuration, {
    message: 'Trim must keep part of the audio: 0 ≤ trimStart < trimEnd ≤ sourceDuration.',
    path: ['trimEnd'],
  })
/** An audio clip on the timeline. */
export type AudioClip = z.infer<typeof audioClipSchema>

/** One caption: its text and when it shows. */
export const captionItemSchema = z
  .object({ end: ms, id: motionId, start: ms, text: z.string().trim().min(1).max(300) })
  .refine((item) => item.end > item.start, {
    message: 'A caption must end after it starts.',
    path: ['end'],
  })
/** A caption. */
export type CaptionItem = z.infer<typeof captionItemSchema>

const fontIds = fontFamilies.map((font) => font.id) as [string, ...string[]]

/** A caption's weight. */
export const captionWeightSchema = z.enum(['normal', 'bold'])

/** How captions look: one style for the whole track, like a subtitle track. */
export const captionStyleSchema = z.object({
  background: color,
  color,
  fontFamily: z.enum(fontIds),
  /** Fraction of the canvas width. */
  fontSize: z.number().min(0.01).max(0.12),
  fontWeight: captionWeightSchema,
  /** Vertical centre of the caption, as a percentage of the canvas height. */
  y: z.number().min(0).max(100),
})
/** Caption styling. */
export type CaptionStyle = z.infer<typeof captionStyleSchema>

/** The look new captions start with. */
export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  background: 'rgba(0,0,0,0.65)',
  color: '#ffffff',
  fontFamily: 'inter',
  fontSize: 0.032,
  fontWeight: 'bold',
  y: 86,
}

/** The caption track. */
export const captionsSchema = z.object({
  items: z.array(captionItemSchema).max(500),
  style: captionStyleSchema,
})
/** Captions and their style. */
export type Captions = z.infer<typeof captionsSchema>

/** Fields the motion features add to the DesignDocument timeline; documents without them still parse. */
export const timelineMotionShape = {
  audio: z.array(audioClipSchema).max(8).optional(),
  captions: captionsSchema.optional(),
  layerTracks: z.array(keyframeTrackSchema).max(200).optional(),
  reveals: z.array(textRevealSchema).max(40).optional(),
  scrolls: z.array(scrollMotionSchema).max(10).optional(),
}

/** Motion as the editor store keeps it: every list present. */
export type TimelineMotion = {
  audio: AudioClip[]
  captions: Captions
  layerTracks: KeyframeTrack[]
  reveals: TextReveal[]
  scrolls: ScrollMotion[]
}

/** Motion fields as a document's timeline carries them. */
export type TimelineMotionFields = Partial<TimelineMotion>

/** A timeline with no motion beyond preset clips. */
export function emptyMotion(): TimelineMotion {
  return {
    audio: [],
    captions: { items: [], style: { ...DEFAULT_CAPTION_STYLE } },
    layerTracks: [],
    reveals: [],
    scrolls: [],
  }
}

/**
 * The store's motion from a document timeline; missing lists are empty.
 * Keyframes and captions are put in time order, which evaluation relies on.
 */
export function motionFromTimeline(fields: TimelineMotionFields | undefined): TimelineMotion {
  const empty = emptyMotion()
  const motion = structuredClone({
    audio: fields?.audio ?? empty.audio,
    captions: fields?.captions ?? empty.captions,
    layerTracks: fields?.layerTracks ?? empty.layerTracks,
    reveals: fields?.reveals ?? empty.reveals,
    scrolls: fields?.scrolls ?? empty.scrolls,
  })
  for (const track of motion.layerTracks) track.keyframes.sort((a, b) => a.time - b.time)
  motion.captions.items.sort((a, b) => a.start - b.start)
  return motion
}

/**
 * The document fields for the store's motion. Empty lists and unused caption
 * styling are left out, so a design without motion exports exactly as before.
 */
export function timelineFieldsFromMotion(motion: TimelineMotion): TimelineMotionFields {
  return {
    audio: motion.audio.length ? motion.audio : undefined,
    captions: motion.captions.items.length ? motion.captions : undefined,
    layerTracks: motion.layerTracks.length ? motion.layerTracks : undefined,
    reveals: motion.reveals.length ? motion.reveals : undefined,
    scrolls: motion.scrolls.length ? motion.scrolls : undefined,
  }
}

/** True when a design has motion worth a timeline or a video export. */
export function hasMotionContent(motion: TimelineMotion): boolean {
  return (
    motion.audio.length > 0 ||
    motion.captions.items.length > 0 ||
    motion.layerTracks.length > 0 ||
    motion.reveals.length > 0 ||
    motion.scrolls.length > 0
  )
}
