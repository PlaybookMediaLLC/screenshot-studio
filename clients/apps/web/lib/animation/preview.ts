import type { DesignDocument } from '@/lib/design/document'
import type { AnimationPreset } from '@/types/animation'

/** Fraction of a preset's duration its thumbnail shows: mid-motion, not the resting start. */
export const PRESET_PREVIEW_PROGRESS = 0.35

/**
 * The design playing only this animation preset from the start, with stable
 * ids so its preview is cached. Drawing it at
 * `preset.duration * PRESET_PREVIEW_PROGRESS` shows the preset in motion on
 * the user's own design.
 */
export function withAnimationPreset(document: DesignDocument, preset: AnimationPreset): DesignDocument {
  const clipId = `preview-${preset.id}`
  return {
    ...document,
    animation: undefined,
    timeline: {
      clips: [{ color: '#ffffff', duration: preset.duration, id: clipId, name: preset.name, presetId: preset.id, startTime: 0 }],
      duration: Math.max(500, preset.duration),
      isLooping: false,
      tracks: preset.tracks.map((track, trackIndex) => ({
        ...track,
        clipId,
        id: `${clipId}-${trackIndex}`,
        keyframes: track.keyframes.map((keyframe, keyframeIndex) => ({
          ...keyframe,
          id: `${clipId}-${trackIndex}-${keyframeIndex}`,
          properties: { ...keyframe.properties } as Record<string, number>,
        })),
        originalDuration: preset.duration,
      })),
    },
  }
}
