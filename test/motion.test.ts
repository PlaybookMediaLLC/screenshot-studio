import assert from 'node:assert/strict'
import test from 'node:test'
import { planAudioMix, scheduleFrom } from '../lib/animation/audio-mix'
import { normalizeAudioType } from '../lib/animation/audio-type'
import { cubicBezier, easeProgress } from '../lib/animation/bezier'
import {
  addCaption,
  duplicateKeyframe,
  removeKeyframe,
  setKeyframe,
  setScroll,
  updateKeyframe,
} from '../lib/animation/motion-commands'
import {
  captionsAt,
  coverOverflow,
  elementWithMotion,
  IDENTITY_MOTION,
  layerMotionAt,
  revealedUnits,
  revealUnits,
  scrollObjectPosition,
  scrollProgressAt,
  trackValueAt,
} from '../lib/animation/motion-evaluate'
import {
  type AudioClip,
  emptyMotion,
  keyframeTrackSchema,
  type ScrollMotion,
  type TextReveal,
} from '../lib/animation/motion-schema'
import { createElement } from '../lib/editor/elements/schema'
import { useImageStore } from '../lib/store'

const close = (actual: number, expected: number, tolerance = 1e-4, message?: string) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message ?? `${actual} is not within ${tolerance} of ${expected}`
  )

/** The curve's y at x, found by brute force: an independent check on the solver. */
function bruteForceBezier(x1: number, y1: number, x2: number, y2: number, x: number) {
  const point = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3
  let best = 0
  for (let step = 0; step <= 200_000; step++) {
    const t = step / 200_000
    if (Math.abs(point(t, x1, x2) - x) < Math.abs(point(best, x1, x2) - x)) best = t
  }
  return point(best, y1, y2)
}

test('cubic-bezier matches the CSS curves', () => {
  const ease = cubicBezier({ x1: 0.25, x2: 0.25, y1: 0.1, y2: 1 })
  // CSS `ease` at the halfway point, as browsers compute it.
  close(ease(0.5), 0.8024033877399112, 1e-5)
  const easeInOut = cubicBezier({ x1: 0.42, x2: 0.58, y1: 0, y2: 1 })
  close(easeInOut(0.5), 0.5, 1e-6)
  close(easeInOut(0.2) + easeInOut(0.8), 1, 1e-6, 'a symmetric curve mirrors around the middle')
  const linear = cubicBezier({ x1: 0, x2: 1, y1: 0, y2: 1 })
  for (const x of [0.1, 0.33, 0.9]) close(linear(x), x, 1e-6)
  for (const curve of [
    [0.25, 0.1, 0.25, 1],
    [0.42, 0, 1, 1],
    [0, 0, 0.58, 1],
    [0.68, -0.55, 0.265, 1.55],
  ] as const) {
    const [x1, y1, x2, y2] = curve
    const solve = cubicBezier({ x1, x2, y1, y2 })
    for (const x of [0.05, 0.3, 0.5, 0.75, 0.97])
      close(solve(x), bruteForceBezier(x1, y1, x2, y2, x), 2e-4, `${curve} at ${x}`)
  }
  assert.equal(ease(0), 0)
  assert.equal(ease(1), 1)
  close(
    easeProgress(0.5, 'linear', { x1: 0.42, x2: 0.58, y1: 0, y2: 1 }),
    0.5,
    1e-6,
    'a custom curve wins over the name'
  )
  close(easeProgress(0.5, 'ease-in'), 0.25, 1e-9, 'named easings keep their own curves')
})

test('keyframes interpolate per property, and several tracks animate one layer', () => {
  const text = { id: 'text-1', kind: 'text' } as const
  let motion = emptyMotion()
  motion = setKeyframe(motion, {
    easing: 'linear',
    property: 'x',
    target: text,
    time: 0,
    value: 0,
  }).motion
  motion = setKeyframe(motion, {
    easing: 'linear',
    property: 'x',
    target: text,
    time: 1000,
    value: 0.5,
  }).motion
  motion = setKeyframe(motion, { property: 'opacity', target: text, time: 500, value: 0 }).motion
  const fadeIn = setKeyframe(motion, { property: 'opacity', target: text, time: 1500, value: 1 })
  motion = updateKeyframe(fadeIn.motion, fadeIn.trackId, fadeIn.keyframeId, {
    bezier: { x1: 0.42, x2: 0.58, y1: 0, y2: 1 },
  })
  assert.equal(motion.layerTracks.length, 2, 'one track per property')
  for (const track of motion.layerTracks)
    assert.doesNotThrow(() => keyframeTrackSchema.parse(track))

  const at = (time: number) => layerMotionAt(motion.layerTracks, text, time)
  close(at(250).x, 0.125)
  assert.equal(at(250).opacity, 0, 'the first keyframe holds before it')
  close(at(1000).x, 0.5)
  close(at(1000).opacity, 0.5, 1e-6, 'the arriving keyframe’s curve shapes the change')
  assert.equal(at(5000).x, 0.5, 'the last keyframe holds after it')
  assert.equal(at(5000).opacity, 1)
  assert.equal(at(1000).scale, 1, 'properties without a track keep the identity')
  assert.equal(
    layerMotionAt(motion.layerTracks, { id: 'other', kind: 'text' }, 1000),
    IDENTITY_MOTION
  )
  assert.equal(layerMotionAt(motion.layerTracks, { kind: 'image' }, 1000), IDENTITY_MOTION)
})

test('keyframes are added, moved, duplicated, eased, and removed in time order', () => {
  const spotlight = { id: 'spot', kind: 'element' } as const
  let motion = emptyMotion()
  const first = setKeyframe(motion, { property: 'dim', target: spotlight, time: 1000, value: 0.2 })
  motion = setKeyframe(first.motion, {
    property: 'dim',
    target: spotlight,
    time: 0,
    value: 0.9,
  }).motion
  motion = setKeyframe(motion, {
    property: 'dim',
    target: spotlight,
    time: 1000.4,
    value: 5,
  }).motion
  const track = motion.layerTracks[0]!
  assert.deepEqual(
    track.keyframes.map((keyframe) => [keyframe.time, keyframe.value]),
    [
      [0, 0.9],
      [1000, 1],
    ],
    'a keyframe at the same time is updated, and values stay in range'
  )
  const startId = track.keyframes[0]!.id
  motion = updateKeyframe(motion, track.id, startId, { time: 1500 })
  assert.equal(motion.layerTracks[0]!.keyframes[1]!.id, startId, 'moving re-sorts the track')
  motion = updateKeyframe(motion, track.id, first.keyframeId, { time: -50 })
  assert.equal(motion.layerTracks[0]!.keyframes[0]!.time, 0, 'times never go before the start')
  const copy = duplicateKeyframe(motion, track.id, first.keyframeId, 2000)
  assert.equal(copy.motion.layerTracks[0]!.keyframes.length, 3)
  motion = updateKeyframe(copy.motion, track.id, copy.keyframeId!, {
    bezier: { x1: 0, x2: 1, y1: 0, y2: 1 },
  })
  motion = updateKeyframe(motion, track.id, copy.keyframeId!, { bezier: null, easing: 'ease-out' })
  const updated = motion.layerTracks[0]!.keyframes.find(
    (keyframe) => keyframe.id === copy.keyframeId
  )!
  assert.equal('bezier' in updated, false, 'clearing a custom curve removes it')
  assert.equal(updated.easing, 'ease-out')
  for (const keyframe of [...motion.layerTracks[0]!.keyframes])
    motion = removeKeyframe(motion, track.id, keyframe.id)
  assert.equal(motion.layerTracks.length, 0, 'a track without keyframes goes')
})

test('animated spotlights and callouts take their evaluated parameters', () => {
  const spotlight = createElement('spotlight', { aspect: 1, id: 'spot', x: 0.5, y: 0.5 })
  const shown = elementWithMotion(spotlight, {
    ...IDENTITY_MOTION,
    dim: 0.2,
    feather: 0.4,
    scale: 2,
    x: 0.1,
  })
  assert.equal(shown.type, 'spotlight')
  if (shown.type !== 'spotlight') return
  close(shown.x, 0.6)
  close(shown.width, spotlight.width * 2)
  assert.equal(shown.props.dim, 0.2)
  assert.equal(shown.props.feather, 0.4)
  const callout = createElement('callout', { aspect: 1, id: 'call' })
  const zoomed = elementWithMotion(callout, { ...IDENTITY_MOTION, zoom: 4 })
  assert.equal(zoomed.type === 'callout' && zoomed.props.zoom, 4)
})

test('text reveals show whole characters or fading words at given times', () => {
  const reveal: TextReveal = {
    duration: 1000,
    easing: 'linear',
    id: 'r',
    mode: 'typewriter',
    start: 1000,
    targetId: 't',
  }
  const units = revealUnits('Hello', 'typewriter')
  assert.equal(revealedUnits(reveal, units.length, 0), 0, 'hidden before it starts')
  assert.equal(revealedUnits(reveal, units.length, 1000), 0)
  assert.equal(Math.floor(revealedUnits(reveal, units.length, 1500)), 2, 'half way shows “He”')
  assert.equal(revealedUnits(reveal, units.length, 2000), 5)
  assert.equal(revealedUnits(reveal, units.length, 9000), 5, 'complete after it ends')
  assert.deepEqual(
    revealUnits('Hi 👋🏽!', 'typewriter'),
    ['H', 'i', ' ', '👋🏽', '!'],
    'an emoji is one character'
  )
  assert.deepEqual(revealUnits('Ship it  today', 'word'), ['Ship ', 'it  ', 'today'])
  const words = { ...reveal, mode: 'word' as const }
  close(revealedUnits(words, 3, 1500), 1.5, 1e-9, 'the second word is half faded in')
  const eased = { ...reveal, easing: 'ease-in' as const }
  close(revealedUnits(eased, 4, 1500), 1, 1e-9, 'easing shapes the pace')
  // Every frame of a video export lands on the same state for the same time.
  assert.equal(revealedUnits(reveal, 5, 1234.5), revealedUnits(reveal, 5, 1234.5))
})

test('scroll-through eases between pauses and holds at each one', () => {
  const scroll: ScrollMotion = {
    direction: 'vertical',
    duration: 3000,
    easing: 'linear',
    from: 0,
    id: 's',
    pauses: [{ at: 0.5, hold: 1000 }],
    start: 500,
    target: { kind: 'image' },
    to: 1,
    viewport: 1.6,
  }
  assert.equal(scrollProgressAt(scroll, 0), 0, 'holds at the start before it begins')
  close(scrollProgressAt(scroll, 1000), 0.25)
  assert.equal(scrollProgressAt(scroll, 1600), 0.5, 'holds at the pause')
  assert.equal(scrollProgressAt(scroll, 2499), 0.5)
  close(scrollProgressAt(scroll, 3000), 0.75)
  assert.equal(scrollProgressAt(scroll, 3500), 1)
  const back = {
    ...scroll,
    from: 1,
    pauses: [
      { at: 0.25, hold: 500 },
      { at: 0.9, hold: 9 },
    ],
    to: 0,
  }
  close(
    scrollProgressAt(back, 500 + 2500 * 0.75 + 250),
    0.25,
    1e-9,
    'a reverse scroll pauses on its way up'
  )
  const eased = { ...scroll, easing: 'ease-in-out' as const, pauses: [] }
  close(scrollProgressAt(eased, 2000), 0.5, 1e-9)
  assert.ok(scrollProgressAt(eased, 1000) < 1 / 6, 'easing starts slowly')
  assert.equal(
    scrollObjectPosition(0.33333, 'vertical', 300),
    '50% 33.3333%',
    'the offset snaps to a whole pixel'
  )
  assert.equal(scrollObjectPosition(0.25, 'horizontal'), '25% 50%')
  assert.deepEqual(coverOverflow({ height: 4000, width: 1000 }, { height: 500, width: 800 }), {
    x: 0,
    y: 2700,
  })
  const trimmed = setScroll(emptyMotion(), {
    ...scroll,
    pauses: [
      { at: 0.2, hold: 2000 },
      { at: 0.6, hold: 1500 },
    ],
  })
  assert.deepEqual(
    trimmed.scrolls[0]!.pauses,
    [{ at: 0.6, hold: 1500 }],
    'holds never use up the whole scroll'
  )
})

test('captions show from their start until their end', () => {
  let motion = emptyMotion()
  motion = addCaption(motion, { end: 2000, id: 'b', start: 1000, text: 'Second' })
  motion = addCaption(motion, { end: 1000, id: 'a', start: 0, text: 'First' })
  assert.deepEqual(
    motion.captions.items.map((item) => item.id),
    ['a', 'b'],
    'kept in time order'
  )
  assert.deepEqual(
    captionsAt(motion.captions, 999).map((item) => item.text),
    ['First']
  )
  assert.deepEqual(
    captionsAt(motion.captions, 1000).map((item) => item.text),
    ['Second']
  )
  assert.deepEqual(captionsAt(motion.captions, 2000), [])
})

test('the audio mix places, trims, cuts, and gains each clip', () => {
  const clip = (changes: Partial<AudioClip>): AudioClip => ({
    gain: 1,
    id: 'clip',
    muted: false,
    name: 'tone.wav',
    sourceDuration: 10_000,
    src: 'blob:http://localhost/tone',
    start: 0,
    trimEnd: 10_000,
    trimStart: 0,
    ...changes,
  })
  const plan = planAudioMix(
    [
      clip({ gain: 0.5, id: 'a', start: 500, trimEnd: 3000, trimStart: 1000 }),
      clip({ id: 'muted', muted: true }),
      clip({ id: 'silent', gain: 0 }),
      clip({ id: 'late', start: 2500, trimEnd: 5000 }),
      clip({ id: 'after', start: 4000 }),
    ],
    4000
  )
  assert.deepEqual(
    plan.map(({ clipId, duration, gain, offset, when }) => ({
      clipId,
      duration,
      gain,
      offset,
      when,
    })),
    [
      { clipId: 'a', duration: 2, gain: 0.5, offset: 1, when: 0.5 },
      { clipId: 'late', duration: 1.5, gain: 1, offset: 0, when: 2.5 },
    ],
    'muted, silent, and out-of-range clips are left out; the timeline end cuts a clip'
  )
  assert.deepEqual(
    scheduleFrom(plan, 1).map(({ clipId, delay, duration, offset }) => ({
      clipId,
      delay,
      duration,
      offset,
    })),
    [
      { clipId: 'a', delay: 0, duration: 1.5, offset: 1.5 },
      { clipId: 'late', delay: 1.5, duration: 1.5, offset: 0 },
    ],
    'playback from the middle starts the current clip part way in'
  )
  assert.deepEqual(scheduleFrom(plan, 4), [])
})

test('audio files are recognised by type or extension', () => {
  assert.equal(normalizeAudioType('audio/x-wav', 'a.wav'), 'audio/wav')
  assert.equal(normalizeAudioType('audio/mp3', 'a.mp3'), 'audio/mpeg')
  assert.equal(normalizeAudioType('', 'voice.M4A'), 'audio/mp4')
  assert.equal(normalizeAudioType('image/png', 'a.png'), null)
  assert.equal(normalizeAudioType('', 'notes.txt'), null)
})

test('track values hold at the ends of a single keyframe', () => {
  const keyframes = [{ easing: 'linear' as const, id: 'k', time: 500, value: 0.3 }]
  assert.equal(trackValueAt(keyframes, 0), 0.3)
  assert.equal(trackValueAt(keyframes, 900), 0.3)
})

test('motion edits are undoable steps that grow the timeline to fit', () => {
  useImageStore.getState().clearImage()
  useImageStore.temporal.getState().clear()
  const before = useImageStore.getState().timeline.duration
  useImageStore
    .getState()
    .updateMotion((motion) =>
      addCaption(motion, { end: before + 2000, id: 'c', start: 500, text: 'Hi' })
    )
  assert.equal(useImageStore.getState().motion.captions.items.length, 1)
  assert.equal(useImageStore.getState().timeline.duration, before + 2000, 'the timeline holds it')
  useImageStore.temporal.getState().undo()
  assert.equal(useImageStore.getState().motion.captions.items.length, 0)
  assert.equal(useImageStore.getState().timeline.duration, before)
})
