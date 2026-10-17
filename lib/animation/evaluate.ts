import type { AnimatableProperties, AnimationClip, AnimationTrack } from '@/types/animation'
import { getClipInterpolatedProperties, getInterpolatedProperties } from './interpolation'

/** The main image values a timeline can animate. */
export type ImageMotionValues = {
  imageOpacity: number
  perspective3D: Omit<AnimatableProperties, 'imageOpacity'>
}

/**
 * The main image as it looks at `time`. The document's own values are the
 * base: tracks override only what they animate, and only while they apply, so
 * playback never needs to write animated values into the document.
 *
 * Clip tracks play inside their clip (later clips win where clips overlap);
 * tracks without a clip run on the timeline's own clock.
 */
export function evaluateImageMotion(
  document: {
    animationClips: readonly AnimationClip[]
    imageOpacity: number
    perspective3D: Omit<AnimatableProperties, 'imageOpacity'>
    tracks: readonly AnimationTrack[]
  },
  time: number
): ImageMotionValues {
  const base: AnimatableProperties = { ...document.perspective3D, imageOpacity: document.imageOpacity }
  if (document.tracks.length === 0) return { imageOpacity: base.imageOpacity, perspective3D: document.perspective3D }

  const freeTracks = document.tracks.filter((track) => !track.clipId)
  const withFree = freeTracks.length ? getInterpolatedProperties(freeTracks, time, base) : base
  const values = getClipInterpolatedProperties(
    [...document.animationClips],
    document.tracks.filter((track) => track.clipId),
    time,
    withFree
  )
  const { imageOpacity, ...perspective3D } = values
  return { imageOpacity, perspective3D }
}
