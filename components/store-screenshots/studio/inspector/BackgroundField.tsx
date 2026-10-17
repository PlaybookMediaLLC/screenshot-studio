'use client'

import * as React from 'react'
import { CachedImage } from '@/components/ui/cached-image'
import {
  BACKGROUND_CATEGORY_LABELS,
  BACKGROUND_CATEGORY_ORDER,
  backgroundCategories,
  getBackgroundThumbnailUrl,
  getBackgroundUrl,
} from '@/lib/r2-backgrounds'
import { STORE_BACKGROUND_PRESETS } from '@/lib/store-screenshots/config'
import { createAssetMeta } from '@/lib/store-screenshots/document/factory'
import type { Background, StoreAsset } from '@/lib/store-screenshots/document/schema'
import { analyzeImage } from '@/lib/store-screenshots/media/image'
import { cn } from '@/lib/utils'
import { ChoiceField, ColorField, NumberField, SliderField } from '../controls'

/**
 * Background editing used by slides, panoramas, the project theme, and bulk
 * edits. Library images are measured before they are applied so automatic
 * text colors work on them.
 */

/** Presets as version 2 backgrounds. */
export const BACKGROUND_PRESETS: Array<{ name: string; value: Background }> = STORE_BACKGROUND_PRESETS.map((preset) => ({
  name: preset.name,
  value: { kind: 'linear', from: preset.value.from, to: preset.value.to, angle: preset.value.angle },
}))

function backgroundCss(background: Background): string {
  if (background.kind === 'solid') return background.color
  if (background.kind === 'linear') return `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})`
  return background.color
}

async function libraryAsset(path: string): Promise<StoreAsset> {
  const url = getBackgroundUrl(path)
  const base = { id: `remote:${path}`, name: path.split('/').pop() ?? 'Background', mime: 'image/jpeg', bytes: 0, src: url }
  try {
    const response = await fetch(url, { mode: 'cors' })
    const blob = await response.blob()
    const analysis = await analyzeImage(blob, base.name)
    return createAssetMeta({ ...base, mime: blob.type || base.mime, width: analysis.width, height: analysis.height, colorGrid: analysis.colorGrid, topColor: analysis.topColor })
  } catch {
    return createAssetMeta({ ...base, width: 1600, height: 2400 })
  }
}

/** Edit a background. `onChange` receives the new background and any asset it needs. */
export function BackgroundField({
  value,
  onChange,
  onChooseImage,
  palette = [],
  allowInherit,
}: {
  value: Background
  onChange: (background: Background | null, asset?: StoreAsset) => void
  onChooseImage?: () => void
  palette?: string[]
  /** Offer "Use project background" (null). */
  allowInherit?: boolean
}): React.JSX.Element {
  const [libraryOpen, setLibraryOpen] = React.useState(false)
  const [loading, setLoading] = React.useState<string | null>(null)
  const kind = value.kind
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-8 gap-1.5" role="group" aria-label="Background presets">
        {BACKGROUND_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            aria-label={`${preset.name} background`}
            title={preset.name}
            onClick={() => onChange(structuredClone(preset.value))}
            className="aspect-square rounded-md border border-foreground/10 transition-transform hover:scale-105"
            style={{ background: backgroundCss(preset.value) }}
          />
        ))}
      </div>
      <ChoiceField
        label="Fill"
        value={kind}
        options={[
          { value: 'solid', label: 'Solid' },
          { value: 'linear', label: 'Gradient' },
          { value: 'image', label: 'Image' },
        ]}
        onChange={(next) => {
          if (next === kind) return
          if (next === 'solid') onChange({ kind: 'solid', color: value.kind === 'linear' ? value.from : value.color })
          else if (next === 'linear') {
            const base = value.kind === 'solid' || value.kind === 'image' ? value.color : '#FFFFFF'
            onChange({ kind: 'linear', from: base, to: '#FFFFFF', angle: 180 })
          } else if (onChooseImage) onChooseImage()
          else setLibraryOpen(true)
        }}
      />
      {value.kind === 'solid' ? <ColorField label="Color" value={value.color} palette={palette} onChange={(color) => color && onChange({ ...value, color })} /> : null}
      {value.kind === 'linear' ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <ColorField label="From" value={value.from} onChange={(from) => from && onChange({ ...value, from })} />
            <ColorField label="To" value={value.to} onChange={(to) => to && onChange({ ...value, to })} />
          </div>
          <SliderField label="Angle" unit="°" value={value.angle} min={0} max={360} onChange={(angle) => onChange({ ...value, angle })} />
        </>
      ) : null}
      {value.kind === 'image' ? (
        <>
          <ChoiceField
            label="Image fit"
            value={value.fit}
            options={[
              { value: 'cover', label: 'Cover' },
              { value: 'contain', label: 'Contain' },
            ]}
            onChange={(fit) => onChange({ ...value, fit })}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Focus X" unit="%" value={value.focusX} min={0} max={100} onChange={(focusX) => onChange({ ...value, focusX })} />
            <NumberField label="Focus Y" unit="%" value={value.focusY} min={0} max={100} onChange={(focusY) => onChange({ ...value, focusY })} />
          </div>
          <ColorField label="Fallback color" value={value.color} onChange={(color) => color && onChange({ ...value, color })} />
        </>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {onChooseImage ? (
          <button type="button" onClick={onChooseImage} className="h-8 rounded-md border border-foreground/10 px-2 text-[11px] hover:bg-foreground/[0.05]">
            Upload image
          </button>
        ) : null}
        <button type="button" aria-expanded={libraryOpen} onClick={() => setLibraryOpen((open) => !open)} className="h-8 rounded-md border border-foreground/10 px-2 text-[11px] hover:bg-foreground/[0.05]">
          {libraryOpen ? 'Hide library' : 'Image library'}
        </button>
        {allowInherit ? (
          <button type="button" onClick={() => onChange(null)} className="h-8 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-foreground/[0.05]">
            Use project background
          </button>
        ) : null}
      </div>
      {libraryOpen ? (
        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
          {BACKGROUND_CATEGORY_ORDER.map((category) => (
            <div key={category} className="space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground">{BACKGROUND_CATEGORY_LABELS[category] ?? category}</p>
              <div className="grid grid-cols-4 gap-1.5">
                {(backgroundCategories[category] ?? []).map((path, index) => (
                  <button
                    key={path}
                    type="button"
                    disabled={loading !== null}
                    aria-label={`Use ${BACKGROUND_CATEGORY_LABELS[category] ?? category} background ${index + 1}`}
                    onClick={async () => {
                      setLoading(path)
                      const asset = await libraryAsset(path)
                      setLoading(null)
                      onChange({ kind: 'image', assetId: asset.id, fit: 'cover', focusX: 50, focusY: 50, color: asset.colorGrid[13] ?? '#000000' }, asset)
                    }}
                    className={cn('relative aspect-square overflow-hidden rounded-md border border-foreground/10 hover:border-foreground/30', loading === path && 'animate-pulse')}
                  >
                    <CachedImage src={getBackgroundThumbnailUrl(path)} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
