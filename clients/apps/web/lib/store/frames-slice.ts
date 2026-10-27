import { DEFAULT_FRAME_CHROME, type FrameChrome } from '@/lib/frames/schema'

/** The main screenshot's browser or window chrome, in the editor store. */
export interface FramesSlice {
  /** Browser and window options for the main screenshot (its address stays in `browserUrl`). */
  frameChrome: FrameChrome
  /** Merge chrome options for the main screenshot. */
  setFrameChrome: (changes: Partial<FrameChrome>) => void
}

type SetState = (partial: (state: FramesSlice) => Partial<FramesSlice>) => void

/** The frames slice, spread into the editor store. */
export function createFramesSlice(set: SetState): FramesSlice {
  return {
    frameChrome: { ...DEFAULT_FRAME_CHROME },
    setFrameChrome: (changes) =>
      set((state) => ({ frameChrome: { ...state.frameChrome, ...changes } })),
  }
}
