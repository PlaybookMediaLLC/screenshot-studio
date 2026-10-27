'use client';

import * as React from 'react';
import { useImageStore } from '@/lib/store';
import { usePlaybackStore } from '@/lib/store/playback';

/**
 * Calculate which slide should be active at a given time
 * Returns the slide ID or null if no slides
 */
export function getActiveSlideAtTime(
  slides: { id: string; duration: number }[],
  timeMs: number,
  defaultDuration: number
): string | null {
  if (slides.length === 0) return null;
  if (slides.length === 1) return slides[0].id;

  let cumulativeTime = 0;

  for (const slide of slides) {
    const slideDurationMs = (slide.duration || defaultDuration) * 1000;
    if (timeMs < cumulativeTime + slideDurationMs) {
      return slide.id;
    }
    cumulativeTime += slideDurationMs;
  }

  // If past all slides, return the last one
  return slides[slides.length - 1].id;
}

/** Show the slide for `time`. Playback moving between slides is not an undoable edit. */
function showSlideAt(time: number) {
  const state = useImageStore.getState();
  if (state.slides.length < 2) return;
  const targetSlideId = getActiveSlideAtTime(state.slides, time, state.slideshow.defaultDuration);
  if (!targetSlideId || targetSlideId === state.activeSlideId) return;
  const history = useImageStore.temporal.getState();
  history.pause();
  try {
    state.setActiveSlide(targetSlideId);
  } finally {
    history.resume();
  }
}

/**
 * Advance the playhead while playing. The canvas evaluates animation at the
 * playhead itself, so nothing here writes animated values into the design.
 */
export function useTimelinePlayback() {
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const playhead = usePlaybackStore((state) => state.playhead);

  React.useEffect(() => {
    if (!isPlaying) return;
    let lastTime: number | null = null;
    let frame = requestAnimationFrame(function animate(now) {
      const { duration, isLooping } = useImageStore.getState().timeline;
      const delta = lastTime === null ? 0 : now - lastTime;
      lastTime = now;
      let next = usePlaybackStore.getState().playhead + delta;
      if (next >= duration) {
        if (!isLooping) {
          usePlaybackStore.setState({ isPlaying: false, playhead: duration });
          return;
        }
        next = duration > 0 ? next % duration : 0;
      }
      usePlaybackStore.setState({ playhead: next });
      frame = requestAnimationFrame(animate);
    });
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);

  // Scrubbing and playback both show the slide under the playhead.
  React.useEffect(() => {
    showSlideAt(playhead);
  }, [playhead]);
}
