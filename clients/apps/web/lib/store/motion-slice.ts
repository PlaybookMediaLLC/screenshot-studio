import { motionEnd } from '@/lib/animation/motion-evaluate'
import { emptyMotion, type TimelineMotion } from '@/lib/animation/motion-schema'
import type { TimelineState } from '@/types/animation'

/** The longest timeline a document holds, in milliseconds. */
const MAX_TIMELINE_MS = 600_000

/**
 * A design's motion in the editor store: keyframe tracks, text reveals,
 * scroll-throughs, audio, and captions. It is part of the design (saved,
 * undone), unlike the playhead. Edits are pure commands from
 * `lib/animation/motion-commands.ts`.
 */
export interface MotionSlice {
  motion: TimelineMotion
  /**
   * Apply a motion command as one edit. The timeline grows when the motion
   * now ends after it, so nothing added is cut off.
   */
  updateMotion: (change: (motion: TimelineMotion) => TimelineMotion) => void
}

type MotionState = MotionSlice & { timeline: TimelineState }

type SetState = (update: (state: MotionState) => Partial<MotionState>) => void

/** The motion slice, spread into the editor store. */
export function createMotionSlice(set: SetState): MotionSlice {
  return {
    motion: emptyMotion(),
    updateMotion: (change) =>
      set((state) => {
        const motion = change(state.motion)
        const end = Math.min(MAX_TIMELINE_MS, Math.ceil(motionEnd(motion)))
        return end > state.timeline.duration
          ? { motion, timeline: { ...state.timeline, duration: end } }
          : { motion }
      }),
  }
}
