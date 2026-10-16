'use client'

import * as React from 'react'
import { Add01Icon, Delete02Icon, MusicNote01Icon } from 'hugeicons-react'
import { ChoiceField, ColorField, ToggleField } from '@/components/editor/inspector/fields'
import { SectionWrapper } from '@/components/editor/sections'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import {
  addCaption,
  newMotionId,
  removeAudioClip,
  removeCaption,
  setCaptionStyle,
  updateAudioClip,
  updateCaption,
} from '@/lib/animation/motion-commands'
import { captionWeightSchema, type CaptionItem } from '@/lib/animation/motion-schema'
import { fontFamilies } from '@/lib/constants/fonts'
import { AudioImportError, importAudioFile } from '@/lib/editor/import-audio'
import { useImageStore } from '@/lib/store'
import { usePlaybackStore } from '@/lib/store/playback'
import { SecondsField } from './fields'

const ACCEPT_AUDIO = 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.webm'

/** Audio clips on the timeline: import, place, trim, gain, and mute. */
export function AudioSection() {
  const clips = useImageStore((state) => state.motion.audio)
  const updateMotion = useImageStore((state) => state.updateMotion)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [status, setStatus] = React.useState<{ error: string | null; importing: boolean }>({
    error: null,
    importing: false,
  })

  const onFile = async (file: File) => {
    setStatus({ error: null, importing: true })
    try {
      await importAudioFile(file)
      setStatus({ error: null, importing: false })
    } catch (error) {
      setStatus({
        error:
          error instanceof AudioImportError
            ? error.message
            : 'The audio file could not be imported.',
        importing: false,
      })
    }
  }

  return (
    <SectionWrapper title="Audio">
      <input
        accept={ACCEPT_AUDIO}
        aria-label="Audio file"
        className="hidden"
        data-audio-input=""
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.currentTarget.value = ''
          if (file) void onFile(file)
        }}
        ref={inputRef}
        type="file"
      />
      <button
        className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-foreground/10 py-2 text-xs font-medium text-foreground hover:bg-foreground/[0.06] disabled:cursor-wait disabled:opacity-60"
        disabled={status.importing}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        <MusicNote01Icon size={14} />
        {status.importing ? 'Importing audio…' : 'Import audio'}
      </button>
      {status.error ? (
        <p className="text-xs text-destructive" role="alert">
          {status.error}
        </p>
      ) : null}
      {clips.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Music or a voice-over plays with the timeline and is mixed into MP4 and WebM exports.
        </p>
      ) : null}
      {clips.map((clip) => (
        <div
          className="space-y-2 rounded-md border border-foreground/10 p-2"
          data-audio-clip={clip.id}
          key={clip.id}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-medium text-foreground" title={clip.name}>
              {clip.name}
            </span>
            <button
              aria-label={`Remove ${clip.name}`}
              className="cursor-pointer rounded-md p-1 text-destructive hover:bg-destructive/10"
              onClick={() => updateMotion((motion) => removeAudioClip(motion, clip.id))}
              type="button"
            >
              <Delete02Icon size={13} />
            </button>
          </div>
          <SecondsField
            label="Start on timeline"
            onChange={(start) =>
              updateMotion((motion) => updateAudioClip(motion, clip.id, { start }))
            }
            valueMs={clip.start}
          />
          <SecondsField
            label="Trim in"
            max={clip.sourceDuration / 1000}
            onChange={(trimStart) =>
              updateMotion((motion) => updateAudioClip(motion, clip.id, { trimStart }))
            }
            valueMs={clip.trimStart}
          />
          <SecondsField
            label="Trim out"
            max={clip.sourceDuration / 1000}
            onChange={(trimEnd) =>
              updateMotion((motion) => updateAudioClip(motion, clip.id, { trimEnd }))
            }
            valueMs={clip.trimEnd}
          />
          <Slider
            label="Gain"
            max={200}
            min={0}
            onValueChange={([gain]) =>
              updateMotion((motion) =>
                updateAudioClip(motion, clip.id, { gain: (gain ?? 100) / 100 })
              )
            }
            step={1}
            value={[clip.gain * 100]}
            valueDisplay={`${Math.round(clip.gain * 100)}%`}
          />
          <ToggleField
            checked={clip.muted}
            label="Mute"
            onChange={(muted) =>
              updateMotion((motion) => updateAudioClip(motion, clip.id, { muted }))
            }
          />
        </div>
      ))}
    </SectionWrapper>
  )
}

const WEIGHT_CHOICES = captionWeightSchema.options.map((value) => ({
  label: value === 'bold' ? 'Bold' : 'Regular',
  value,
}))

/** One caption's text and timing. Clearing the text keeps the last words until new ones are typed. */
function CaptionRow({ item }: { item: CaptionItem }) {
  const updateMotion = useImageStore((state) => state.updateMotion)
  const [draft, setDraft] = React.useState(item.text)
  React.useEffect(() => setDraft(item.text), [item.text])
  return (
    <div
      className="space-y-2 rounded-md border border-foreground/10 p-2"
      data-caption-row={item.id}
    >
      <Textarea
        aria-invalid={draft.trim() === '' || undefined}
        aria-label="Caption text"
        className="min-h-12 text-xs"
        maxLength={300}
        onChange={(event) => {
          const text = event.target.value
          setDraft(text)
          if (text.trim()) updateMotion((motion) => updateCaption(motion, item.id, { text }))
        }}
        value={draft}
      />
      {draft.trim() === '' ? (
        <p className="text-[11px] text-destructive">A caption needs some text.</p>
      ) : null}
      <SecondsField
        label="Start"
        onChange={(start) => updateMotion((motion) => updateCaption(motion, item.id, { start }))}
        valueMs={item.start}
      />
      <SecondsField
        label="End"
        onChange={(end) => updateMotion((motion) => updateCaption(motion, item.id, { end }))}
        valueMs={item.end}
      />
      <button
        className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md py-1 text-xs text-destructive hover:bg-destructive/10"
        onClick={() => updateMotion((motion) => removeCaption(motion, item.id))}
        type="button"
      >
        <Delete02Icon size={13} /> Remove caption
      </button>
    </div>
  )
}

/** The caption track: timed lines burned into video exports, and how they look. */
export function CaptionsSection() {
  const captions = useImageStore((state) => state.motion.captions)
  const updateMotion = useImageStore((state) => state.updateMotion)
  const fontId = React.useId()
  const { style } = captions

  return (
    <SectionWrapper title="Captions">
      <button
        className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-foreground/10 py-2 text-xs font-medium text-foreground hover:bg-foreground/[0.06]"
        onClick={() => {
          const start = Math.round(usePlaybackStore.getState().playhead)
          // Two seconds, kept inside the timeline when there is room.
          const end = Math.min(
            start + 2000,
            Math.max(start + 500, useImageStore.getState().timeline.duration)
          )
          updateMotion((motion) =>
            addCaption(motion, { end, id: newMotionId('caption'), start, text: 'New caption' })
          )
        }}
        type="button"
      >
        <Add01Icon size={14} /> Add caption at playhead
      </button>
      {captions.items.map((item) => (
        <CaptionRow item={item} key={item.id} />
      ))}
      {captions.items.length > 0 ? (
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs text-muted-foreground" htmlFor={fontId}>
              Font
            </label>
            <select
              className="h-7 max-w-40 rounded-md border border-foreground/10 bg-background px-2 text-xs text-foreground"
              id={fontId}
              onChange={(event) =>
                updateMotion((motion) =>
                  setCaptionStyle(motion, { fontFamily: event.target.value })
                )
              }
              value={style.fontFamily}
            >
              {fontFamilies.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.name}
                </option>
              ))}
            </select>
          </div>
          <ChoiceField
            label="Weight"
            onChange={(fontWeight) =>
              updateMotion((motion) => setCaptionStyle(motion, { fontWeight }))
            }
            options={WEIGHT_CHOICES}
            value={style.fontWeight}
          />
          <Slider
            label="Size"
            max={12}
            min={1}
            onValueChange={([size]) =>
              updateMotion((motion) => setCaptionStyle(motion, { fontSize: (size ?? 3) / 100 }))
            }
            step={0.1}
            value={[style.fontSize * 100]}
            valueDisplay={`${(style.fontSize * 100).toFixed(1)}%`}
          />
          <Slider
            label="Position"
            max={100}
            min={0}
            onValueChange={([y]) =>
              updateMotion((motion) => setCaptionStyle(motion, { y: y ?? 86 }))
            }
            step={1}
            value={[style.y]}
            valueDisplay={`${Math.round(style.y)}%`}
          />
          <ColorField
            label="Text"
            onChange={(color) => updateMotion((motion) => setCaptionStyle(motion, { color }))}
            value={style.color}
          />
          <ColorField
            label="Background"
            onChange={(background) =>
              updateMotion((motion) => setCaptionStyle(motion, { background }))
            }
            value={style.background}
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Captions are burned into video exports.</p>
      )}
    </SectionWrapper>
  )
}
