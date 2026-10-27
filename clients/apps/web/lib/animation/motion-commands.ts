import { findTrack } from './motion-evaluate'
import {
  type AudioClip,
  type CaptionItem,
  type CaptionStyle,
  type CubicBezier,
  type EasingName,
  type KeyframeTrack,
  LAYER_PROPERTY_RANGES,
  type LayerKeyframe,
  type LayerProperty,
  type MotionTarget,
  type ScrollMotion,
  type ScrollTarget,
  type TextReveal,
  type TimelineMotion,
} from './motion-schema'

/**
 * Edits to a design's motion, as pure functions from one motion to the next.
 * The store applies them through `updateMotion`, so each is one undo step,
 * and they keep the invariants evaluation relies on: keyframes sorted by
 * time, values inside their property's range, trims inside their source.
 */

/** A new id for a piece of motion. */
export function newMotionId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const MAX_TIME = 600_000

function byTime<T extends { time: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.time - b.time)
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T
}

function replaceById<T extends { id: string }>(
  items: readonly T[],
  id: string,
  change: (item: T) => T
): T[] {
  return items.map((item) => (item.id === id ? change(item) : item))
}

/** A property value clamped to the property's range. */
export function clampPropertyValue(property: LayerProperty, value: number): number {
  const range = LAYER_PROPERTY_RANGES[property]
  return clamp(Number.isFinite(value) ? value : range.identity, range.min, range.max)
}

/**
 * Set a layer property's value at a time: the keyframe already there is
 * updated, otherwise a keyframe (and, for a new property, its track) is
 * added. Returns the keyframe's id with the new motion.
 */
export function setKeyframe(
  motion: TimelineMotion,
  input: {
    easing?: EasingName
    property: LayerProperty
    target: MotionTarget
    time: number
    value: number
  }
): { keyframeId: string; motion: TimelineMotion; trackId: string } {
  const time = clamp(Math.round(input.time), 0, MAX_TIME)
  const value = clampPropertyValue(input.property, input.value)
  const existing = findTrack(motion.layerTracks, input.target, input.property)
  if (!existing) {
    const keyframe: LayerKeyframe = {
      easing: input.easing ?? 'ease-in-out',
      id: newMotionId('kf'),
      time,
      value,
    }
    const track: KeyframeTrack = {
      id: newMotionId('track'),
      keyframes: [keyframe],
      property: input.property,
      target: input.target,
    }
    return {
      keyframeId: keyframe.id,
      motion: { ...motion, layerTracks: [...motion.layerTracks, track] },
      trackId: track.id,
    }
  }
  const atTime = existing.keyframes.find((keyframe) => Math.abs(keyframe.time - time) < 1)
  const keyframe: LayerKeyframe = atTime
    ? { ...atTime, value }
    : { easing: input.easing ?? 'ease-in-out', id: newMotionId('kf'), time, value }
  const keyframes = byTime([
    ...existing.keyframes.filter((item) => item.id !== keyframe.id),
    keyframe,
  ])
  return {
    keyframeId: keyframe.id,
    motion: {
      ...motion,
      layerTracks: replaceById(motion.layerTracks, existing.id, (track) => ({
        ...track,
        keyframes,
      })),
    },
    trackId: existing.id,
  }
}

/** The changes a keyframe takes; `bezier: null` returns it to its named easing. */
export type KeyframeChanges = {
  bezier?: CubicBezier | null
  easing?: EasingName
  time?: number
  value?: number
}

/** Change a keyframe's time, value, or easing, keeping its track sorted. */
export function updateKeyframe(
  motion: TimelineMotion,
  trackId: string,
  keyframeId: string,
  changes: KeyframeChanges
): TimelineMotion {
  return {
    ...motion,
    layerTracks: replaceById(motion.layerTracks, trackId, (track) => ({
      ...track,
      keyframes: byTime(
        track.keyframes.map((keyframe) => {
          if (keyframe.id !== keyframeId) return keyframe
          const { bezier, ...rest } = { ...keyframe, ...withoutUndefined(changes) }
          return withoutUndefined({
            ...rest,
            bezier: bezier === null ? undefined : bezier,
            time: clamp(Math.round(rest.time), 0, MAX_TIME),
            value: clampPropertyValue(track.property, rest.value),
          })
        })
      ),
    })),
  }
}

/** Remove a keyframe; a track left without keyframes goes too. */
export function removeKeyframe(
  motion: TimelineMotion,
  trackId: string,
  keyframeId: string
): TimelineMotion {
  return {
    ...motion,
    layerTracks: motion.layerTracks
      .map((track) =>
        track.id === trackId
          ? {
              ...track,
              keyframes: track.keyframes.filter((keyframe) => keyframe.id !== keyframeId),
            }
          : track
      )
      .filter((track) => track.keyframes.length > 0),
  }
}

/** Copy a keyframe to another time on its track; a keyframe already there is replaced. */
export function duplicateKeyframe(
  motion: TimelineMotion,
  trackId: string,
  keyframeId: string,
  time: number
): { keyframeId: string | null; motion: TimelineMotion } {
  const track = motion.layerTracks.find((item) => item.id === trackId)
  const source = track?.keyframes.find((keyframe) => keyframe.id === keyframeId)
  if (!track || !source) return { keyframeId: null, motion }
  const copy: LayerKeyframe = {
    ...structuredClone(source),
    id: newMotionId('kf'),
    time: clamp(Math.round(time), 0, MAX_TIME),
  }
  const keyframes = byTime([
    ...track.keyframes.filter((keyframe) => Math.abs(keyframe.time - copy.time) >= 1),
    copy,
  ])
  return {
    keyframeId: copy.id,
    motion: {
      ...motion,
      layerTracks: replaceById(motion.layerTracks, trackId, (item) => ({ ...item, keyframes })),
    },
  }
}

/** Remove a whole keyframe track. */
export function removeTrack(motion: TimelineMotion, trackId: string): TimelineMotion {
  return { ...motion, layerTracks: motion.layerTracks.filter((track) => track.id !== trackId) }
}

/** Add or replace a text layer's reveal; a text has at most one. */
export function setReveal(motion: TimelineMotion, reveal: TextReveal): TimelineMotion {
  const clean = withoutUndefined({
    ...reveal,
    duration: clamp(Math.round(reveal.duration), 50, MAX_TIME),
    start: clamp(Math.round(reveal.start), 0, MAX_TIME),
  })
  const others = motion.reveals.filter(
    (item) => item.targetId !== reveal.targetId && item.id !== reveal.id
  )
  return { ...motion, reveals: [...others, clean] }
}

/** Remove a reveal. */
export function removeReveal(motion: TimelineMotion, revealId: string): TimelineMotion {
  return { ...motion, reveals: motion.reveals.filter((reveal) => reveal.id !== revealId) }
}

/** True when two scroll targets name the same layer. */
export function sameScrollTarget(a: ScrollTarget, b: ScrollTarget): boolean {
  return a.kind === 'image' || b.kind === 'image' ? a.kind === b.kind : a.id === b.id
}

/** Add or replace a layer's scroll-through; a layer has at most one. */
export function setScroll(motion: TimelineMotion, scroll: ScrollMotion): TimelineMotion {
  const duration = clamp(Math.round(scroll.duration), 100, MAX_TIME)
  const pauses = scroll.pauses
    .map((pause) => ({ at: clamp(pause.at, 0, 1), hold: clamp(Math.round(pause.hold), 0, 60_000) }))
    .sort((a, b) => a.at - b.at)
  // Holds must leave time to scroll: trim the longest holds until they do.
  while (pauses.reduce((total, pause) => total + pause.hold, 0) >= duration && pauses.length) {
    pauses.splice(
      pauses.indexOf(
        pauses.reduce((longest, pause) => (pause.hold > longest.hold ? pause : longest))
      ),
      1
    )
  }
  const clean = withoutUndefined({
    ...scroll,
    duration,
    from: clamp(scroll.from, 0, 1),
    pauses,
    start: clamp(Math.round(scroll.start), 0, MAX_TIME),
    to: clamp(scroll.to, 0, 1),
    viewport: clamp(scroll.viewport, 0.25, 4),
  })
  const others = motion.scrolls.filter(
    (item) => !sameScrollTarget(item.target, scroll.target) && item.id !== scroll.id
  )
  return { ...motion, scrolls: [...others, clean] }
}

/** Remove a scroll-through. */
export function removeScroll(motion: TimelineMotion, scrollId: string): TimelineMotion {
  return { ...motion, scrolls: motion.scrolls.filter((scroll) => scroll.id !== scrollId) }
}

/** A clip kept inside its source: trim in order, start and gain in range. */
function cleanClip(clip: AudioClip): AudioClip {
  const sourceDuration = Math.max(1, Math.round(clip.sourceDuration))
  const trimStart = clamp(Math.round(clip.trimStart), 0, sourceDuration - 1)
  return {
    ...clip,
    gain: clamp(clip.gain, 0, 2),
    sourceDuration,
    start: clamp(Math.round(clip.start), 0, MAX_TIME),
    trimEnd: clamp(Math.round(clip.trimEnd), trimStart + 1, sourceDuration),
    trimStart,
  }
}

/** Add an audio clip. */
export function addAudioClip(motion: TimelineMotion, clip: AudioClip): TimelineMotion {
  return { ...motion, audio: [...motion.audio, cleanClip(clip)] }
}

/** Change an audio clip's placement, trim, gain, or mute. */
export function updateAudioClip(
  motion: TimelineMotion,
  clipId: string,
  changes: Partial<Pick<AudioClip, 'gain' | 'muted' | 'start' | 'trimEnd' | 'trimStart'>>
): TimelineMotion {
  return {
    ...motion,
    audio: replaceById(motion.audio, clipId, (clip) => cleanClip({ ...clip, ...changes })),
  }
}

/** Remove an audio clip. */
export function removeAudioClip(motion: TimelineMotion, clipId: string): TimelineMotion {
  return { ...motion, audio: motion.audio.filter((clip) => clip.id !== clipId) }
}

function cleanCaption(item: CaptionItem): CaptionItem {
  const start = clamp(Math.round(item.start), 0, MAX_TIME - 1)
  return {
    ...item,
    end: clamp(Math.round(item.end), start + 1, MAX_TIME),
    start,
    text: item.text.slice(0, 300),
  }
}

function byStart(items: CaptionItem[]): CaptionItem[] {
  return [...items].sort((a, b) => a.start - b.start)
}

/** Add a caption, keeping captions in time order. */
export function addCaption(motion: TimelineMotion, item: CaptionItem): TimelineMotion {
  return {
    ...motion,
    captions: {
      ...motion.captions,
      items: byStart([...motion.captions.items, cleanCaption(item)]),
    },
  }
}

/** Change a caption's text or timing. */
export function updateCaption(
  motion: TimelineMotion,
  captionId: string,
  changes: Partial<Pick<CaptionItem, 'end' | 'start' | 'text'>>
): TimelineMotion {
  return {
    ...motion,
    captions: {
      ...motion.captions,
      items: byStart(
        replaceById(motion.captions.items, captionId, (item) =>
          cleanCaption({ ...item, ...changes })
        )
      ),
    },
  }
}

/** Remove a caption. */
export function removeCaption(motion: TimelineMotion, captionId: string): TimelineMotion {
  return {
    ...motion,
    captions: {
      ...motion.captions,
      items: motion.captions.items.filter((item) => item.id !== captionId),
    },
  }
}

/** Change how every caption looks. */
export function setCaptionStyle(
  motion: TimelineMotion,
  changes: Partial<CaptionStyle>
): TimelineMotion {
  return {
    ...motion,
    captions: {
      ...motion.captions,
      style: { ...motion.captions.style, ...withoutUndefined(changes) },
    },
  }
}
