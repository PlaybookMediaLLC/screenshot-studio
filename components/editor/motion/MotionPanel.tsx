'use client'

import * as React from 'react'
import { Copy01Icon, Delete02Icon, DiamondIcon } from 'hugeicons-react'
import { ChoiceField, ToggleField } from '@/components/editor/inspector/fields'
import { SectionWrapper } from '@/components/editor/sections'
import { Slider } from '@/components/ui/slider'
import {
  duplicateKeyframe,
  newMotionId,
  removeKeyframe,
  removeReveal,
  removeScroll,
  sameScrollTarget,
  setKeyframe,
  setReveal,
  setScroll,
  updateKeyframe,
} from '@/lib/animation/motion-commands'
import { findTrack, revealUnits, trackValueAt } from '@/lib/animation/motion-evaluate'
import {
  type LayerProperty,
  type MotionTarget,
  type RevealMode,
  type ScrollMotion,
  type ScrollTarget,
  scrollDirectionSchema,
} from '@/lib/animation/motion-schema'
import {
  animatableProperties,
  PROPERTY_LABELS,
  propertyDisplay,
  restingValue,
  selectionTarget,
  targetLabel,
} from '@/lib/animation/motion-targets'
import { useEditorSelection } from '@/lib/editor/selection'
import { useImageStore } from '@/lib/store'
import { useMotionUI } from '@/lib/store/motion-ui'
import { usePlaybackStore } from '@/lib/store/playback'
import { cn } from '@/lib/utils'
import { EasingField } from './EasingField'
import { formatSeconds, NumberField, SecondsField } from './fields'
import { AudioSection, CaptionsSection } from './MediaSections'
import { Button } from '@/components/ui/button'

/**
 * The Motion tab's own sections: keyframes for the selected layer, the
 * selected keyframe with its easing curve, text reveals, scroll-through,
 * audio, and captions. Every control edits the design through a motion
 * command; the canvas shows the result at the playhead.
 */
export function MotionPanel() {
  const selection = useEditorSelection()
  const target = React.useMemo(
    () => selectionTarget(selection),
    // The selection is rebuilt each render; its kind and id are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection?.kind, selection?.id]
  )
  return (
    <div className="space-y-1" data-keep-selection="" data-motion-panel="">
      <KeyframesSection target={target} />
      <SelectedKeyframeSection />
      {target?.kind === 'text' ? <TextRevealSection textId={target.id} /> : null}
      {target?.kind === 'image' || target?.kind === 'device' ? (
        <ScrollSection target={target} />
      ) : null}
      <AudioSection />
      <CaptionsSection />
    </div>
  )
}

function KeyframesSection({ target }: { target: MotionTarget | null }) {
  const element = useImageStore((state) =>
    target?.kind === 'element' ? state.elements.find((item) => item.id === target.id) : undefined
  )
  const playhead = usePlaybackStore((state) => state.playhead)
  if (!target) {
    return (
      <SectionWrapper title="Keyframes">
        <p className="text-xs text-muted-foreground">
          Select the screenshot, a text, sticker, device, or element to animate it.
        </p>
      </SectionWrapper>
    )
  }
  return (
    <SectionWrapper title="Keyframes">
      <p className="text-[11px] leading-snug text-muted-foreground">
        Values at the playhead ({formatSeconds(playhead)}). Changing one keys it there; ◆ adds or
        removes a keyframe.
      </p>
      <div className="space-y-1.5">
        {animatableProperties(element).map((property) => (
          <PropertyRow
            element={element}
            key={property}
            playhead={playhead}
            property={property}
            target={target}
          />
        ))}
      </div>
    </SectionWrapper>
  )
}

function PropertyRow({
  element,
  playhead,
  property,
  target,
}: {
  element: Parameters<typeof animatableProperties>[0]
  playhead: number
  property: LayerProperty
  target: MotionTarget
}) {
  const track = useImageStore((state) => findTrack(state.motion.layerTracks, target, property))
  const updateMotion = useImageStore((state) => state.updateMotion)
  const selectKeyframe = useMotionUI((state) => state.selectKeyframe)
  const display = propertyDisplay(property)
  const value = track ? trackValueAt(track.keyframes, playhead) : restingValue(property, element)
  const atPlayhead = track?.keyframes.find((keyframe) => Math.abs(keyframe.time - playhead) < 1)
  const label = PROPERTY_LABELS[property]

  const key = (next: number) => {
    let selected: { keyframeId: string; trackId: string } | null = null
    updateMotion((motion) => {
      const result = setKeyframe(motion, { property, target, time: playhead, value: next })
      selected = { keyframeId: result.keyframeId, trackId: result.trackId }
      return result.motion
    })
    selectKeyframe(selected)
  }

  return (
    <div className="flex items-center gap-2" data-property-row={property}>
      <Button variant="custom" size={null}
        aria-label={atPlayhead ? `Remove ${label} keyframe` : `Add ${label} keyframe`}
        aria-pressed={Boolean(atPlayhead)}
        className={cn(
          'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          atPlayhead
            ? 'text-primary'
            : track
              ? 'text-foreground/60 hover:text-foreground'
              : 'text-foreground/25 hover:text-foreground/60'
        )}
        onClick={() => {
          if (atPlayhead && track) {
            updateMotion((motion) => removeKeyframe(motion, track.id, atPlayhead.id))
            selectKeyframe(null)
          } else {
            key(value)
          }
        }}
        title={
          atPlayhead ? 'Remove the keyframe at the playhead' : 'Add a keyframe at the playhead'
        }
        type="button"
      >
        <DiamondIcon size={13} />
      </Button>
      <div className="min-w-0 flex-1">
        <NumberField
          label={label}
          max={display.max}
          min={display.min}
          onChange={(shown) => key(display.fromDisplay(shown))}
          step={display.step}
          suffix={display.suffix}
          value={display.toDisplay(value)}
        />
      </div>
    </div>
  )
}

function SelectedKeyframeSection() {
  const selected = useMotionUI((state) => state.selectedKeyframe)
  const selectKeyframe = useMotionUI((state) => state.selectKeyframe)
  const track = useImageStore((state) =>
    selected ? state.motion.layerTracks.find((item) => item.id === selected.trackId) : undefined
  )
  const layer = useImageStore((state) => (track ? targetLabel(state, track.target) : null))
  const updateMotion = useImageStore((state) => state.updateMotion)
  const playhead = usePlaybackStore((state) => state.playhead)
  const keyframe = track?.keyframes.find((item) => item.id === selected?.keyframeId)
  if (!track || !keyframe) return null
  const display = propertyDisplay(track.property)

  return (
    <SectionWrapper title="Selected keyframe">
      <p className="text-xs font-medium text-foreground" data-selected-keyframe={keyframe.id}>
        {layer ?? 'Missing layer'} · {PROPERTY_LABELS[track.property]}
      </p>
      <SecondsField
        label="Time"
        onChange={(time) =>
          updateMotion((motion) => updateKeyframe(motion, track.id, keyframe.id, { time }))
        }
        valueMs={keyframe.time}
      />
      <NumberField
        label="Value"
        max={display.max}
        min={display.min}
        onChange={(shown) =>
          updateMotion((motion) =>
            updateKeyframe(motion, track.id, keyframe.id, { value: display.fromDisplay(shown) })
          )
        }
        step={display.step}
        suffix={display.suffix}
        value={display.toDisplay(keyframe.value)}
      />
      <EasingField
        label="Easing into this keyframe"
        onChange={(change) =>
          updateMotion((motion) => updateKeyframe(motion, track.id, keyframe.id, change))
        }
        value={keyframe}
      />
      <div className="flex gap-2">
        <Button variant="custom" size={null}
          className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-foreground hover:bg-foreground/[0.06]"
          onClick={() => {
            // To the playhead, or half a second later when the keyframe is already there.
            const time = Math.abs(playhead - keyframe.time) < 1 ? keyframe.time + 500 : playhead
            let copyId: string | null = null
            updateMotion((motion) => {
              const result = duplicateKeyframe(motion, track.id, keyframe.id, time)
              copyId = result.keyframeId
              return result.motion
            })
            if (copyId) selectKeyframe({ keyframeId: copyId, trackId: track.id })
          }}
          type="button"
        >
          <Copy01Icon size={13} /> Duplicate
        </Button>
        <Button variant="custom" size={null}
          className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-destructive hover:bg-destructive/10"
          onClick={() => {
            updateMotion((motion) => removeKeyframe(motion, track.id, keyframe.id))
            selectKeyframe(null)
          }}
          type="button"
        >
          <Delete02Icon size={13} /> Delete
        </Button>
      </div>
    </SectionWrapper>
  )
}

const REVEAL_CHOICES = [
  { label: 'Off', value: 'off' },
  { label: 'Typewriter', value: 'typewriter' },
  { label: 'Word by word', value: 'word' },
] as const

function TextRevealSection({ textId }: { textId: string }) {
  const text = useImageStore(
    (state) => state.textOverlays.find((item) => item.id === textId)?.text ?? ''
  )
  const reveal = useImageStore((state) =>
    state.motion.reveals.find((item) => item.targetId === textId)
  )
  const updateMotion = useImageStore((state) => state.updateMotion)
  const units = reveal ? revealUnits(text, reveal.mode).length : 0
  const unitName = reveal?.mode === 'word' ? 'words' : 'characters'

  const setMode = (mode: 'off' | RevealMode) => {
    if (mode === 'off') {
      if (reveal) updateMotion((motion) => removeReveal(motion, reveal.id))
      return
    }
    const count = revealUnits(text, mode).length
    updateMotion((motion) =>
      setReveal(motion, {
        duration: reveal?.duration ?? Math.max(400, count * (mode === 'word' ? 250 : 60)),
        easing: reveal?.easing ?? 'linear',
        ...(reveal?.bezier ? { bezier: reveal.bezier } : {}),
        id: reveal?.id ?? newMotionId('reveal'),
        mode,
        start: reveal?.start ?? Math.round(usePlaybackStore.getState().playhead),
        targetId: textId,
      })
    )
  }

  return (
    <SectionWrapper title="Text reveal">
      <ChoiceField
        label="Reveal"
        onChange={setMode}
        options={REVEAL_CHOICES}
        value={reveal?.mode ?? 'off'}
      />
      {reveal ? (
        <>
          <SecondsField
            label="Start"
            onChange={(start) => updateMotion((motion) => setReveal(motion, { ...reveal, start }))}
            valueMs={reveal.start}
          />
          <SecondsField
            label="Duration"
            min={0.05}
            onChange={(duration) =>
              updateMotion((motion) => setReveal(motion, { ...reveal, duration }))
            }
            valueMs={reveal.duration}
          />
          <NumberField
            label={`Speed (${unitName}/s)`}
            max={200}
            min={0.1}
            onChange={(speed) =>
              updateMotion((motion) =>
                setReveal(motion, {
                  ...reveal,
                  duration: Math.round((Math.max(1, units) / speed) * 1000),
                })
              )
            }
            step={0.5}
            value={Math.round((Math.max(1, units) / (reveal.duration / 1000)) * 10) / 10}
          />
          <EasingField
            onChange={({ bezier, easing }) =>
              updateMotion((motion) =>
                setReveal(motion, { ...reveal, bezier: bezier ?? undefined, easing })
              )
            }
            value={reveal}
          />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Type the text in, one character or one word at a time.
        </p>
      )}
    </SectionWrapper>
  )
}

const VIEWPORTS = [
  { label: '16:10', value: '1.6' },
  { label: '16:9', value: '1.778' },
  { label: '4:3', value: '1.333' },
  { label: '1:1', value: '1' },
  { label: '9:16', value: '0.5625' },
] as const

const DIRECTION_CHOICES = scrollDirectionSchema.options.map((value) => ({
  label: value === 'vertical' ? 'Vertical' : 'Horizontal',
  value,
}))

function ScrollSection({ target }: { target: ScrollTarget }) {
  const scroll = useImageStore((state) =>
    state.motion.scrolls.find((item) => sameScrollTarget(item.target, target))
  )
  const updateMotion = useImageStore((state) => state.updateMotion)
  const save = (changes: Partial<ScrollMotion>) =>
    scroll ? updateMotion((motion) => setScroll(motion, { ...scroll, ...changes })) : undefined
  const percent = (value: number) => `${Math.round(value * 100)}%`

  return (
    <SectionWrapper title="Scroll-through">
      <ToggleField
        checked={Boolean(scroll)}
        label={
          target.kind === 'image'
            ? 'Scroll the screenshot in its frame'
            : 'Scroll the device screen'
        }
        onChange={(on) => {
          if (!on) {
            if (scroll) updateMotion((motion) => removeScroll(motion, scroll.id))
            return
          }
          // Fill the rest of the timeline from the playhead, or all of it near the end.
          const { duration } = useImageStore.getState().timeline
          const playhead = Math.round(usePlaybackStore.getState().playhead)
          const start = playhead <= duration - 1000 ? playhead : 0
          updateMotion((motion) =>
            setScroll(motion, {
              direction: 'vertical',
              duration: Math.max(1000, duration - start),
              easing: 'ease-in-out',
              from: 0,
              id: newMotionId('scroll'),
              pauses: [],
              start,
              target,
              to: 1,
              viewport: 1.6,
            })
          )
        }}
      />
      {scroll ? (
        <>
          <ChoiceField
            label="Direction"
            onChange={(direction) => save({ direction })}
            options={DIRECTION_CHOICES}
            value={scroll.direction}
          />
          {target.kind === 'image' ? (
            <ChoiceField
              label="Viewport"
              onChange={(viewport) => save({ viewport: Number(viewport) })}
              options={VIEWPORTS}
              value={
                VIEWPORTS.reduce((closest, item) =>
                  Math.abs(Number(item.value) - scroll.viewport) <
                  Math.abs(Number(closest.value) - scroll.viewport)
                    ? item
                    : closest
                ).value
              }
            />
          ) : null}
          <Slider
            label="From"
            max={100}
            min={0}
            onValueChange={([from]) => save({ from: (from ?? 0) / 100 })}
            step={1}
            value={[scroll.from * 100]}
            valueDisplay={percent(scroll.from)}
          />
          <Slider
            label="To"
            max={100}
            min={0}
            onValueChange={([to]) => save({ to: (to ?? 100) / 100 })}
            step={1}
            value={[scroll.to * 100]}
            valueDisplay={percent(scroll.to)}
          />
          <SecondsField
            label="Start"
            onChange={(start) => save({ start })}
            valueMs={scroll.start}
          />
          <SecondsField
            label="Duration"
            min={0.1}
            onChange={(duration) => save({ duration })}
            valueMs={scroll.duration}
          />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Pauses</span>
              <Button variant="custom" size={null}
                className="cursor-pointer rounded-md px-2 py-1 text-xs text-foreground hover:bg-foreground/[0.06]"
                onClick={() =>
                  save({
                    pauses: [...scroll.pauses, { at: (scroll.from + scroll.to) / 2, hold: 600 }],
                  })
                }
                type="button"
              >
                Add pause
              </Button>
            </div>
            {scroll.pauses.map((pause, index) => (
              <div className="space-y-1.5 rounded-md border border-foreground/10 p-2" key={index}>
                <Slider
                  label={`Pause ${index + 1} at`}
                  max={100}
                  min={0}
                  onValueChange={([at]) =>
                    save({
                      pauses: scroll.pauses.map((item, place) =>
                        place === index ? { ...item, at: (at ?? 0) / 100 } : item
                      ),
                    })
                  }
                  step={1}
                  value={[pause.at * 100]}
                  valueDisplay={percent(pause.at)}
                />
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <SecondsField
                      label="Hold"
                      onChange={(hold) =>
                        save({
                          pauses: scroll.pauses.map((item, place) =>
                            place === index ? { ...item, hold } : item
                          ),
                        })
                      }
                      valueMs={pause.hold}
                    />
                  </div>
                  <Button variant="custom" size={null}
                    aria-label={`Remove pause ${index + 1}`}
                    className="cursor-pointer rounded-md p-1 text-destructive hover:bg-destructive/10"
                    onClick={() =>
                      save({ pauses: scroll.pauses.filter((_, place) => place !== index) })
                    }
                    type="button"
                  >
                    <Delete02Icon size={13} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <EasingField
            label="Easing between pauses"
            onChange={({ bezier, easing }) => save({ bezier: bezier ?? undefined, easing })}
            value={scroll}
          />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Show a long screenshot scrolling through its{' '}
          {target.kind === 'image' ? 'frame' : 'screen'}.
        </p>
      )}
    </SectionWrapper>
  )
}
