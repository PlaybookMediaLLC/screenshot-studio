import { z } from 'zod'
import type { AnimationSettings, StoreDocument } from '../document/schema'

/**
 * The animation model. A frame is a pure function of the settings, the
 * slide durations, and a time, so the preview player and the GIF/MP4
 * encoders draw identical frames for identical inputs.
 *
 * Each slide is drawn as three layers rendered by the shared renderer:
 * background, content (devices, badges, callouts, images), and text.
 * Transitions move whole slides; text reveals and device motion move only
 * their layer.
 */

/** Layers a slide is split into for animation. */
export const animationLayerSchema = z.enum(['background', 'content', 'text'])

/** Animation layer. */
export type AnimationLayer = z.infer<typeof animationLayerSchema>

/** Animated export formats. */
export const animationFormatSchema = z.enum(['mp4', 'gif'])

/** Animated export format. */
export type AnimationFormat = z.infer<typeof animationFormatSchema>

/** How one layer of one slide is drawn in a frame. Offsets are fractions of the frame size. */
export type LayerDraw = { opacity: number; dx: number; dy: number; scale: number }

/** One slide's contribution to a frame. */
export type SlideDraw = { slideIndex: number; slide: LayerDraw; layers: Record<AnimationLayer, LayerDraw> }

/** Everything to draw at one instant, back to front. */
export type FrameState = { time: number; slides: SlideDraw[] }

/** Seconds each slide is shown, in order. */
export function slideDurations(document: StoreDocument, slideIds: string[]): number[] {
  return slideIds.map((id) => document.animation.slideDurations[id] ?? document.animation.slideDuration)
}

/** Total length in seconds. */
export function totalDuration(durations: number[]): number {
  return durations.reduce((sum, value) => sum + value, 0)
}

const easeOut = (t: number) => 1 - (1 - t) ** 3
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

const IDENTITY: LayerDraw = { opacity: 1, dx: 0, dy: 0, scale: 1 }

/** Layer effects at `local` seconds into a slide. */
function layerEffects(settings: AnimationSettings, local: number, duration: number): Record<AnimationLayer, LayerDraw> {
  const reveal = easeOut(clamp01(local / 0.6))
  const text: LayerDraw =
    settings.textReveal === 'none'
      ? IDENTITY
      : { opacity: reveal, dx: 0, dy: settings.textReveal === 'rise' ? (1 - reveal) * 0.03 : 0, scale: 1 }
  const rise = easeOut(clamp01((local - 0.1) / 0.8))
  const content: LayerDraw =
    settings.deviceMotion === 'rise'
      ? { opacity: clamp01(local / 0.3), dx: 0, dy: (1 - rise) * 0.08, scale: 1 }
      : settings.deviceMotion === 'float'
        ? { opacity: 1, dx: 0, dy: Math.sin((local / Math.max(duration, 0.5)) * Math.PI * 2) * 0.008, scale: 1 }
        : IDENTITY
  const zoom = 1 + settings.kenBurns * clamp01(local / Math.max(duration, 0.1))
  return { background: { ...IDENTITY, scale: zoom }, content, text }
}

/**
 * The frame at time `t` (seconds). The transition into slide i+1 plays
 * during the last `transitionDuration` seconds of slide i, so the total
 * length is the sum of the slide durations.
 */
export function frameAt(settings: AnimationSettings, durations: number[], t: number): FrameState {
  const total = totalDuration(durations)
  const time = Math.min(Math.max(0, t), Math.max(0, total - 1e-6))
  let start = 0
  let index = 0
  while (index < durations.length - 1 && time >= start + durations[index]) {
    start += durations[index]
    index += 1
  }
  const local = time - start
  const duration = durations[index]
  const transition = Math.min(settings.transitionDuration, duration * 0.6)
  const current: SlideDraw = { slideIndex: index, slide: { ...IDENTITY }, layers: layerEffects(settings, local, duration) }
  const transitionStart = duration - transition
  if (settings.transition === 'none' || index >= durations.length - 1 || transition <= 0 || local < transitionStart) {
    return { time, slides: [current] }
  }
  const p = easeInOut(clamp01((local - transitionStart) / transition))
  const next: SlideDraw = { slideIndex: index + 1, slide: { ...IDENTITY }, layers: layerEffects(settings, 0, durations[index + 1]) }
  if (settings.transition === 'fade') {
    next.slide = { ...IDENTITY, opacity: p }
  } else if (settings.transition === 'slide') {
    current.slide = { ...IDENTITY, dx: -p }
    next.slide = { ...IDENTITY, dx: 1 - p }
  } else {
    current.slide = { ...IDENTITY, opacity: 1 - p, scale: 1 + 0.08 * p }
    next.slide = { ...IDENTITY, opacity: p, scale: 0.92 + 0.08 * p }
  }
  return { time, slides: [current, next] }
}

/** Frame count for a duration at a frame rate. */
export function frameCount(durations: number[], fps: number): number {
  return Math.max(1, Math.round(totalDuration(durations) * fps))
}

/** Output presets for animated exports. */
export const ANIMATION_PRESETS = [
  { id: 'app-preview-portrait', name: 'App preview portrait (886 × 1920)', width: 886, height: 1920 },
  { id: 'story', name: 'Story / Reels / Shorts (1080 × 1920)', width: 1080, height: 1920 },
  { id: 'square', name: 'Square post (1080 × 1080)', width: 1080, height: 1080 },
  { id: 'landscape', name: 'Landscape (1920 × 1080)', width: 1920, height: 1080 },
  { id: 'gif-small', name: 'Small GIF (540 × 1170)', width: 540, height: 1170 },
] as const
