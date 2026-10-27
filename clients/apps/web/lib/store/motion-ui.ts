'use client'

import { create } from 'zustand'

/** A keyframe, by its track and its own id. */
export type KeyframeRef = { keyframeId: string; trackId: string }

/**
 * Which keyframe the timeline and the Motion panel are editing. Session
 * state: never saved with a design and never undone.
 */
export interface MotionUIState {
  selectedKeyframe: KeyframeRef | null
  selectKeyframe: (keyframe: KeyframeRef | null) => void
}

/** The selected keyframe, shared by the timeline and the Motion panel. */
export const useMotionUI = create<MotionUIState>()((set) => ({
  selectKeyframe: (selectedKeyframe) => set({ selectedKeyframe }),
  selectedKeyframe: null,
}))
