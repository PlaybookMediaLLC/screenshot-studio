import type { CanvasElement } from '@/lib/editor/elements/schema'
import { easeProgress } from './bezier'
import type { ImageMotionValues } from './evaluate'
import type {
  AudioClip,
  CaptionItem,
  Captions,
  KeyframeTrack,
  LayerKeyframe,
  LayerProperty,
  MotionTarget,
  ScrollDirection,
  ScrollMotion,
  TextReveal,
  TimelineMotion,
} from './motion-schema'

/**
 * Motion evaluated at a time. Every function here is pure: the same motion
 * and time always give the same values, which is what makes each exported
 * video or GIF frame exact. The canvas draws these values; nothing here
 * writes into the design.
 */

/** A layer's animated values: offsets and multipliers on its own, and effect overrides. */
export type LayerMotion = {
  /** Offset as a fraction of the canvas width. */
  x: number
  /** Offset as a fraction of the canvas height. */
  y: number
  /** Multiplies the layer's scale. */
  scale: number
  /** Degrees added to the layer's rotation. */
  rotation: number
  /** Multiplies the layer's opacity. */
  opacity: number
  /** Spotlight dimming, replacing the element's own. */
  dim?: number
  /** Spotlight edge softness, replacing the element's own. */
  feather?: number
  /** Callout magnification, replacing the element's own. */
  zoom?: number
}

/** A layer that nothing animates. */
export const IDENTITY_MOTION: Readonly<LayerMotion> = Object.freeze({
  opacity: 1,
  rotation: 0,
  scale: 1,
  x: 0,
  y: 0,
})

/** True when two targets name the same layer. */
export function sameTarget(a: MotionTarget, b: MotionTarget): boolean {
  if (a.kind === 'image' || b.kind === 'image') return a.kind === b.kind
  return a.kind === b.kind && a.id === b.id
}

/** A stable key for a target, for lookups and React keys. */
export function targetKey(target: MotionTarget): string {
  return target.kind === 'image' ? 'image' : `${target.kind}:${target.id}`
}

/**
 * A track's value at `time`. The first keyframe's value holds before it and
 * the last one's after it; between two keyframes the later one's easing
 * shapes the change.
 */
export function trackValueAt(keyframes: readonly LayerKeyframe[], time: number): number {
  const first = keyframes[0]
  if (!first) return 0
  if (time <= first.time) return first.value
  for (let index = 1; index < keyframes.length; index++) {
    const next = keyframes[index]!
    if (time < next.time) {
      const previous = keyframes[index - 1]!
      const span = next.time - previous.time
      const progress = span > 0 ? (time - previous.time) / span : 1
      return (
        previous.value +
        (next.value - previous.value) * easeProgress(progress, next.easing, next.bezier)
      )
    }
  }
  return keyframes[keyframes.length - 1]!.value
}

/** Every animated value of one layer at `time`; properties without a track keep the identity. */
export function layerMotionAt(
  tracks: readonly KeyframeTrack[],
  target: MotionTarget,
  time: number
): LayerMotion {
  let motion: LayerMotion | null = null
  for (const track of tracks) {
    if (!sameTarget(track.target, target)) continue
    motion ??= { ...IDENTITY_MOTION }
    motion[track.property] = trackValueAt(track.keyframes, time)
  }
  return motion ?? IDENTITY_MOTION
}

/**
 * An element as drawn under its motion: moved, resized, turned, faded, and
 * with its spotlight or callout parameters replaced where they animate.
 */
export function elementWithMotion(element: CanvasElement, motion: LayerMotion): CanvasElement {
  const moved = {
    ...element,
    height: element.height * motion.scale,
    opacity: element.opacity * motion.opacity,
    rotation: element.rotation + motion.rotation,
    width: element.width * motion.scale,
    x: element.x + motion.x,
    y: element.y + motion.y,
  }
  if (moved.type === 'spotlight') {
    return {
      ...moved,
      props: {
        ...moved.props,
        dim: motion.dim ?? moved.props.dim,
        feather: motion.feather ?? moved.props.feather,
      },
    }
  }
  if (moved.type === 'callout')
    return { ...moved, props: { ...moved.props, zoom: motion.zoom ?? moved.props.zoom } }
  return moved
}

/**
 * The main image's drawn values with its keyframed motion on top of its
 * preset clips. Offsets become the 3D layer's translate, a percentage of the
 * framed image's own size.
 */
export function imageWithMotion(
  base: ImageMotionValues,
  motion: LayerMotion,
  frame: { canvasH: number; canvasW: number; framedH: number; framedW: number }
): ImageMotionValues {
  if (motion === IDENTITY_MOTION) return base
  return {
    imageOpacity: base.imageOpacity * motion.opacity,
    perspective3D: {
      ...base.perspective3D,
      rotateZ: base.perspective3D.rotateZ + motion.rotation,
      scale: base.perspective3D.scale * motion.scale,
      translateX:
        base.perspective3D.translateX +
        (frame.framedW > 0 ? (motion.x * frame.canvasW * 100) / frame.framedW : 0),
      translateY:
        base.perspective3D.translateY +
        (frame.framedH > 0 ? (motion.y * frame.canvasH * 100) / frame.framedH : 0),
    },
  }
}

/** True when a layer's motion changes nothing about how it is drawn. */
export function isIdentityMotion(motion: LayerMotion): boolean {
  return (
    motion.x === 0 &&
    motion.y === 0 &&
    motion.scale === 1 &&
    motion.rotation === 0 &&
    motion.opacity === 1 &&
    motion.dim === undefined &&
    motion.feather === undefined &&
    motion.zoom === undefined
  )
}

/** True when any track animates the layer. */
export function hasLayerTracks(tracks: readonly KeyframeTrack[], target: MotionTarget): boolean {
  return tracks.some((track) => sameTarget(track.target, target))
}

/** The track animating one property of one layer, if any. */
export function findTrack(
  tracks: readonly KeyframeTrack[],
  target: MotionTarget,
  property: LayerProperty
): KeyframeTrack | undefined {
  return tracks.find((track) => track.property === property && sameTarget(track.target, target))
}

const graphemes =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

/**
 * The pieces a reveal shows one at a time: characters for a typewriter
 * (whole emoji and accented letters, never half of one), or words with the
 * space after each for a word reveal.
 */
export function revealUnits(text: string, mode: TextReveal['mode']): string[] {
  if (mode === 'word') {
    const words = text.match(/\s*\S+\s*/g)
    return words ?? [text]
  }
  return graphemes ? Array.from(graphemes.segment(text), (part) => part.segment) : Array.from(text)
}

/**
 * How much of a text a reveal shows at `time`, in units: 0 before it starts,
 * the unit count once it ends. A fraction means the next unit is appearing,
 * which word reveals draw as a fade.
 */
export function revealedUnits(reveal: TextReveal, unitCount: number, time: number): number {
  const progress = easeProgress(
    (time - reveal.start) / reveal.duration,
    reveal.easing,
    reveal.bezier
  )
  return Math.max(0, Math.min(unitCount, progress * unitCount))
}

/**
 * The scroll position at `time`, as a fraction of the scrollable range. The
 * content holds at `from` before the scroll starts and at `to` after it
 * ends. Each leg between pauses eases on its own and takes time in
 * proportion to its distance, so the scroll keeps one pace across legs.
 */
export function scrollProgressAt(scroll: ScrollMotion, time: number): number {
  const { from, to } = scroll
  const local = time - scroll.start
  if (local <= 0) return from
  if (local >= scroll.duration) return to
  const forward = to >= from
  const stops = scroll.pauses
    .filter((pause) =>
      forward ? pause.at > from && pause.at < to : pause.at < from && pause.at > to
    )
    .sort((a, b) => (forward ? a.at - b.at : b.at - a.at))
  const holding = stops.reduce((total, pause) => total + pause.hold, 0)
  const moving = Math.max(1, scroll.duration - holding)
  const distance = Math.abs(to - from)
  let clock = 0
  let position = from
  for (const leg of [...stops, { at: to, hold: 0 }]) {
    const legTime = distance > 0 ? (moving * Math.abs(leg.at - position)) / distance : 0
    if (legTime > 0 && local < clock + legTime) {
      return (
        position +
        (leg.at - position) * easeProgress((local - clock) / legTime, scroll.easing, scroll.bezier)
      )
    }
    clock += legTime
    if (local < clock + leg.hold) return leg.at
    clock += leg.hold
    position = leg.at
  }
  return to
}

/**
 * The CSS `object-position` that shows a cover-fitted image scrolled to
 * `progress`. With `rangePx` (how far the image overflows its viewport, in
 * stage px) the offset snaps to whole pixels, so a long screenshot's text
 * never shimmers between frames.
 */
export function scrollObjectPosition(
  progress: number,
  direction: ScrollDirection,
  rangePx?: number
): string {
  const snapped = rangePx && rangePx >= 1 ? Math.round(progress * rangePx) / rangePx : progress
  const percent = `${Number((snapped * 100).toFixed(4))}%`
  return direction === 'vertical' ? `50% ${percent}` : `${percent} 50%`
}

/** How far an image of `natural` size overflows a `viewport` it covers, in viewport px. */
export function coverOverflow(
  natural: { height: number; width: number },
  viewport: { height: number; width: number }
): { x: number; y: number } {
  if (natural.width <= 0 || natural.height <= 0) return { x: 0, y: 0 }
  const scale = Math.max(viewport.width / natural.width, viewport.height / natural.height)
  return {
    x: Math.max(0, natural.width * scale - viewport.width),
    y: Math.max(0, natural.height * scale - viewport.height),
  }
}

/** The captions showing at `time`: each from its start up to, not including, its end. */
export function captionsAt(captions: Captions, time: number): CaptionItem[] {
  return captions.items.filter((item) => time >= item.start && time < item.end)
}

/** How long an audio clip plays on the timeline. */
export function audioClipLength(clip: AudioClip): number {
  return clip.trimEnd - clip.trimStart
}

/** When the last piece of motion ends, so the timeline can be made long enough to hold it. */
export function motionEnd(motion: TimelineMotion): number {
  return Math.max(
    0,
    ...motion.layerTracks.map((track) => track.keyframes[track.keyframes.length - 1]?.time ?? 0),
    ...motion.reveals.map((reveal) => reveal.start + reveal.duration),
    ...motion.scrolls.map((scroll) => scroll.start + scroll.duration),
    ...motion.captions.items.map((item) => item.end)
  )
}
