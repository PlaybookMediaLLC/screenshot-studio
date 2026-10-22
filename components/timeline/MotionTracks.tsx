'use client'

import * as React from 'react'
import { PiX as Cancel01Icon, PiClosedCaptioning as ClosedCaptionIcon, PiMusicNote as MusicNote01Icon, PiArrowsVertical as ScrollVerticalIcon, PiTextAa as TextFontIcon } from 'react-icons/pi'
import {
  duplicateKeyframe,
  removeAudioClip,
  removeCaption,
  removeKeyframe,
  removeReveal,
  removeScroll,
  removeTrack,
  setKeyframe,
  setReveal,
  setScroll,
  updateAudioClip,
  updateCaption,
  updateKeyframe,
} from '@/lib/animation/motion-commands'
import { audioClipLength, targetKey, trackValueAt } from '@/lib/animation/motion-evaluate'
import type { KeyframeTrack, TimelineMotion } from '@/lib/animation/motion-schema'
import { PROPERTY_LABELS, targetLabel } from '@/lib/animation/motion-targets'
import { useShallow } from 'zustand/react/shallow'
import { useImageStore } from '@/lib/store'
import { useMotionUI } from '@/lib/store/motion-ui'
import { usePlaybackStore } from '@/lib/store/playback'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/** Height of one motion row in the timeline, in px. */
export const MOTION_ROW_HEIGHT = 30

/** How many rows the design's motion takes in the timeline. */
export function motionRowCount(motion: TimelineMotion): number {
  return (
    motion.layerTracks.length +
    motion.reveals.length +
    motion.scrolls.length +
    motion.audio.length +
    (motion.captions.items.length > 0 ? 1 : 0)
  )
}

type Geometry = { duration: number; labelWidth: number; trackWidth: number }

const timeAt = (geometry: Geometry, px: number) => (px / geometry.trackWidth) * geometry.duration
const pxAt = (geometry: Geometry, time: number) => (time / geometry.duration) * geometry.trackWidth
const snap = (time: number) => Math.round(time / 10) * 10

/**
 * Rows for the design's motion in the timeline: a row per keyframed layer
 * property, per text reveal, per scroll-through, per audio clip, and one for
 * captions. Keyframes and spans drag along the timeline, and work from the
 * keyboard when focused.
 */
export function MotionTracks(geometry: Geometry) {
  const motion = useImageStore((state) => state.motion)
  const names = useImageStore(
    useShallow((state) => {
      const names: Record<string, string> = {}
      for (const track of state.motion.layerTracks) {
        names[targetKey(track.target)] = targetLabel(state, track.target) ?? 'Missing layer'
      }
      for (const reveal of state.motion.reveals) {
        names[`text:${reveal.targetId}`] =
          targetLabel(state, { id: reveal.targetId, kind: 'text' }) ?? 'Missing text'
      }
      for (const scroll of state.motion.scrolls) {
        names[targetKey(scroll.target)] = targetLabel(state, scroll.target) ?? 'Missing layer'
      }
      return names
    })
  )
  const updateMotion = useImageStore((state) => state.updateMotion)

  return (
    <div data-motion-tracks="">
      {motion.layerTracks.map((track) => (
        <Row
          geometry={geometry}
          icon={null}
          key={track.id}
          label={`${names[targetKey(track.target)]} · ${PROPERTY_LABELS[track.property]}`}
          onRemove={() => updateMotion((current) => removeTrack(current, track.id))}
          removeLabel={`Remove the ${PROPERTY_LABELS[track.property]} animation`}
        >
          <KeyframeLane geometry={geometry} track={track} />
        </Row>
      ))}
      {motion.reveals.map((reveal) => (
        <Row
          geometry={geometry}
          icon={<TextFontIcon size={12} />}
          key={reveal.id}
          label={`Reveal ${names[`text:${reveal.targetId}`]}`}
          onRemove={() => updateMotion((current) => removeReveal(current, reveal.id))}
          removeLabel="Remove the text reveal"
        >
          <Span
            end={reveal.start + reveal.duration}
            geometry={geometry}
            label={reveal.mode === 'word' ? 'Word by word' : 'Typewriter'}
            onChange={({ end, start }) =>
              updateMotion((current) =>
                setReveal(current, { ...reveal, duration: end - start, start })
              )
            }
            start={reveal.start}
            tone="text"
          />
        </Row>
      ))}
      {motion.scrolls.map((scroll) => (
        <Row
          geometry={geometry}
          icon={<ScrollVerticalIcon size={12} />}
          key={scroll.id}
          label={`Scroll ${names[targetKey(scroll.target)]}`}
          onRemove={() => updateMotion((current) => removeScroll(current, scroll.id))}
          removeLabel="Remove the scroll-through"
        >
          <Span
            end={scroll.start + scroll.duration}
            geometry={geometry}
            label={`${Math.round(scroll.from * 100)}% → ${Math.round(scroll.to * 100)}%`}
            onChange={({ end, start }) =>
              updateMotion((current) =>
                setScroll(current, { ...scroll, duration: end - start, start })
              )
            }
            start={scroll.start}
            tone="scroll"
          />
        </Row>
      ))}
      {motion.audio.map((clip) => (
        <Row
          geometry={geometry}
          icon={<MusicNote01Icon size={12} />}
          key={clip.id}
          label={clip.name}
          onRemove={() => updateMotion((current) => removeAudioClip(current, clip.id))}
          removeLabel={`Remove ${clip.name}`}
        >
          <Span
            end={clip.start + audioClipLength(clip)}
            geometry={geometry}
            label={clip.muted ? `${clip.name} (muted)` : clip.name}
            onChange={({ end, start }, edge) => {
              // Trimming the front keeps the rest of the audio where it was, and
              // stops at the start of the file.
              const front = Math.max(-clip.trimStart, start - clip.start)
              updateMotion((current) =>
                updateAudioClip(
                  current,
                  clip.id,
                  edge === 'start'
                    ? { start: clip.start + front, trimStart: clip.trimStart + front }
                    : edge === 'end'
                      ? { trimEnd: clip.trimStart + (end - start) }
                      : { start }
                )
              )
            }}
            start={clip.start}
            tone="audio"
          />
        </Row>
      ))}
      {motion.captions.items.length > 0 ? (
        <Row geometry={geometry} icon={<ClosedCaptionIcon size={12} />} label="Captions">
          {motion.captions.items.map((item) => (
            <Span
              end={item.end}
              geometry={geometry}
              key={item.id}
              label={item.text}
              onChange={({ end, start }) =>
                updateMotion((current) => updateCaption(current, item.id, { end, start }))
              }
              onDelete={() => updateMotion((current) => removeCaption(current, item.id))}
              start={item.start}
              tone="caption"
            />
          ))}
        </Row>
      ) : null}
    </div>
  )
}

function Row({
  children,
  geometry,
  icon,
  label,
  onRemove,
  removeLabel,
}: {
  children: React.ReactNode
  geometry: Geometry
  icon: React.ReactNode
  label: string
  onRemove?: () => void
  removeLabel?: string
}) {
  return (
    <div className="flex border-b border-foreground/10" style={{ height: MOTION_ROW_HEIGHT }}>
      <div
        className="group/label flex shrink-0 items-center gap-1.5 border-r border-foreground/10 pl-3 pr-1"
        style={{ width: geometry.labelWidth }}
        title={label}
      >
        {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-muted-foreground">
          {label}
        </span>
        {onRemove ? (
          <Button variant="custom" size={null}
            aria-label={removeLabel}
            className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover/label:opacity-100"
            onClick={onRemove}
            type="button"
          >
            <Cancel01Icon size={9} />
          </Button>
        ) : null}
      </div>
      <div
        className="relative shrink-0 bg-foreground/[0.015]"
        style={{ width: geometry.trackWidth }}
      >
        {children}
      </div>
    </div>
  )
}

/** A track's keyframes; double-click the lane to add one there. */
function KeyframeLane({ geometry, track }: { geometry: Geometry; track: KeyframeTrack }) {
  const updateMotion = useImageStore((state) => state.updateMotion)
  const selectKeyframe = useMotionUI((state) => state.selectKeyframe)
  return (
    <div
      className="absolute inset-0"
      data-keyframe-lane={track.id}
      onDoubleClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect()
        const time = snap(
          Math.max(0, Math.min(geometry.duration, timeAt(geometry, event.clientX - box.left)))
        )
        let added: { keyframeId: string; trackId: string } | null = null
        updateMotion((motion) => {
          const result = setKeyframe(motion, {
            property: track.property,
            target: track.target,
            time,
            value: trackValueAt(track.keyframes, time),
          })
          added = { keyframeId: result.keyframeId, trackId: result.trackId }
          return result.motion
        })
        selectKeyframe(added)
        usePlaybackStore.getState().seek(time)
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-foreground/10" />
      {track.keyframes.map((keyframe) => (
        <Diamond
          geometry={geometry}
          key={keyframe.id}
          keyframeId={keyframe.id}
          time={keyframe.time}
          trackId={track.id}
        />
      ))}
    </div>
  )
}

function Diamond({
  geometry,
  keyframeId,
  time,
  trackId,
}: {
  geometry: Geometry
  keyframeId: string
  time: number
  trackId: string
}) {
  const updateMotion = useImageStore((state) => state.updateMotion)
  const selected = useMotionUI(
    (state) =>
      state.selectedKeyframe?.keyframeId === keyframeId &&
      state.selectedKeyframe.trackId === trackId
  )
  const selectKeyframe = useMotionUI((state) => state.selectKeyframe)
  const drag = React.useRef<{ pointerX: number; time: number } | null>(null)

  const select = () => {
    selectKeyframe({ keyframeId, trackId })
    usePlaybackStore.getState().pause()
  }
  const move = (next: number) => {
    const clamped = Math.max(0, Math.min(geometry.duration, next))
    updateMotion((motion) => updateKeyframe(motion, trackId, keyframeId, { time: clamped }))
    usePlaybackStore.getState().seek(clamped)
  }

  return (
    <Button variant="custom" size={null}
      aria-label={`Keyframe at ${(time / 1000).toFixed(2)} seconds`}
      aria-pressed={selected}
      className={cn(
        'absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-grab rounded-[2px] border transition-[background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing',
        selected
          ? 'border-primary bg-primary shadow-sm'
          : 'border-foreground/40 bg-card hover:bg-foreground/20'
      )}
      data-keyframe={keyframeId}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 100 : 10
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          move(time + (event.key === 'ArrowLeft' ? -step : step))
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault()
          updateMotion((motion) => removeKeyframe(motion, trackId, keyframeId))
          selectKeyframe(null)
        } else if (event.key.toLowerCase() === 'd' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          let copy: string | null = null
          updateMotion((motion) => {
            const result = duplicateKeyframe(motion, trackId, keyframeId, time + 500)
            copy = result.keyframeId
            return result.motion
          })
          if (copy) selectKeyframe({ keyframeId: copy, trackId })
        }
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { pointerX: event.clientX, time }
        select()
        usePlaybackStore.getState().seek(time)
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        move(snap(drag.current.time + timeAt(geometry, event.clientX - drag.current.pointerX)))
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onFocus={select}
      style={{ left: pxAt(geometry, time) }}
      title="Drag to move · ←/→ nudge · ⌘D duplicate · Delete remove"
      type="button"
    />
  )
}

const TONES = {
  audio: 'border-sky-500/40 bg-sky-500/15 text-sky-950 dark:text-sky-100',
  caption: 'border-amber-500/40 bg-amber-500/15 text-amber-950 dark:text-amber-100',
  scroll: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-950 dark:text-emerald-100',
  text: 'border-violet-500/40 bg-violet-500/15 text-violet-950 dark:text-violet-100',
} as const

type Edge = 'start' | 'end' | 'move'

/**
 * A span on the timeline: drag it to move, drag an edge to change where it
 * starts or ends. Arrow keys move it when focused (Shift for larger steps),
 * Alt with an arrow changes its end.
 */
function Span({
  end,
  geometry,
  label,
  onChange,
  onDelete,
  start,
  tone,
}: {
  end: number
  geometry: Geometry
  label: string
  onChange: (span: { end: number; start: number }, edge: Edge) => void
  onDelete?: () => void
  start: number
  tone: keyof typeof TONES
}) {
  const drag = React.useRef<{ edge: Edge; end: number; pointerX: number; start: number } | null>(
    null
  )
  const length = end - start
  const MIN = 100

  const apply = (edge: Edge, delta: number, from: { end: number; start: number }) => {
    if (edge === 'move') {
      const nextStart = Math.max(0, snap(from.start + delta))
      onChange({ end: nextStart + (from.end - from.start), start: nextStart }, edge)
    } else if (edge === 'start') {
      onChange(
        { end: from.end, start: Math.max(0, Math.min(from.end - MIN, snap(from.start + delta))) },
        edge
      )
    } else {
      onChange({ end: Math.max(from.start + MIN, snap(from.end + delta)), start: from.start }, edge)
    }
  }

  const startDrag = (edge: Edge) => (event: React.PointerEvent<HTMLElement>) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { edge, end, pointerX: event.clientX, start }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const active = drag.current
    if (!active) return
    apply(active.edge, timeAt(geometry, event.clientX - active.pointerX), active)
  }
  const stop = () => (drag.current = null)

  return (
    <div
      aria-label={`${label}, ${(start / 1000).toFixed(2)}s to ${(end / 1000).toFixed(2)}s`}
      className={cn(
        'absolute inset-y-1 flex cursor-grab items-center overflow-hidden rounded-md border px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing',
        TONES[tone]
      )}
      data-timeline-span={tone}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 500 : 50
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          apply(event.altKey ? 'end' : 'move', event.key === 'ArrowLeft' ? -step : step, {
            end,
            start,
          })
        } else if ((event.key === 'Delete' || event.key === 'Backspace') && onDelete) {
          event.preventDefault()
          onDelete()
        }
      }}
      onPointerCancel={stop}
      onPointerDown={startDrag('move')}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      role="group"
      style={{ left: pxAt(geometry, start), width: Math.max(6, pxAt(geometry, length)) }}
      tabIndex={0}
      title={label}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-foreground/15"
        data-span-edge="start"
        onPointerDown={startDrag('start')}
        onPointerMove={onPointerMove}
        onPointerUp={stop}
      />
      <span className="pointer-events-none truncate text-[10px] font-medium">{label}</span>
      <span
        aria-hidden
        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-foreground/15"
        data-span-edge="end"
        onPointerDown={startDrag('end')}
        onPointerMove={onPointerMove}
        onPointerUp={stop}
      />
    </div>
  )
}
