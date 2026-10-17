'use client'

import * as React from 'react'
import type { LayerOwner } from '@/lib/store-screenshots/commands/schema'
import { TEXT_ROLE_LABELS } from '@/lib/store-screenshots/document/factory'
import { textRoleSchema, type TextLayer, type TextStyle, type TextStyleOverrides } from '@/lib/store-screenshots/document/schema'
import { roundTo } from '@/lib/store-screenshots/engine/geometry'
import type { SceneText } from '@/lib/store-screenshots/engine/scene'
import { localizedContent, resolveTextStyle } from '@/lib/store-screenshots/engine/text'
import { useActiveScene } from '../active-scene'
import { ALIGN_ICONS, ChoiceField, ColorField, NumberField, Section, SelectField, ToggleField } from '../controls'
import { useEditor, useEditorApi } from '../editor-store'
import { FontPicker } from './FontPicker'
import { LayerStateSection, TransformSection, useBaseWidth, useLayerPatch } from './shared'

/** Font weight names. */
export const WEIGHT_OPTIONS = [
  { value: '100', label: '100 · Thin' },
  { value: '200', label: '200 · Extra light' },
  { value: '300', label: '300 · Light' },
  { value: '400', label: '400 · Regular' },
  { value: '500', label: '500 · Medium' },
  { value: '600', label: '600 · Semibold' },
  { value: '700', label: '700 · Bold' },
  { value: '800', label: '800 · Extra bold' },
  { value: '900', label: '900 · Black' },
]

const STATE_LABELS = {
  source: 'Source text',
  translated: 'Translated',
  outdated: 'Outdated: the source changed',
  missing: 'Not translated yet: showing source',
} as const

/**
 * Typography fields shared by the text inspector, the project style panel,
 * and bulk editing. Sizes are pixels at the 1320 px reference width; line
 * height is a multiplier; letter spacing is a percentage of the size.
 */
export function TypographyFields({
  style,
  onChange,
  showColor,
  colorNode,
  palette,
}: {
  style: TextStyle
  onChange: (patch: TextStyleOverrides, key: string) => void
  showColor?: boolean
  colorNode?: SceneText
  palette?: string[]
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      <FontPicker label="Font" value={style.fontFamily} onChange={(fontFamily) => onChange({ fontFamily }, 'font')} />
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Size" unit="px" value={style.fontSize} min={12} max={400} onChange={(fontSize) => onChange({ fontSize }, 'size')} hint="At 1320 px wide" />
        <SelectField label="Weight" value={String(style.fontWeight)} options={WEIGHT_OPTIONS} onChange={(value) => onChange({ fontWeight: Number(value) }, 'weight')} />
        <NumberField label="Line height" unit="×" value={style.lineHeight} min={0.7} max={3} step={0.05} precision={2} onChange={(lineHeight) => onChange({ lineHeight }, 'line')} />
        <NumberField
          label="Letter spacing"
          unit="%"
          value={roundTo(style.letterSpacing * 100, 1)}
          min={-20}
          max={50}
          step={0.5}
          precision={1}
          onChange={(value) => onChange({ letterSpacing: value / 100 }, 'tracking')}
        />
      </div>
      <ChoiceField
        label="Alignment"
        value={style.align}
        options={[
          { value: 'left', label: 'Align left', icon: ALIGN_ICONS.left },
          { value: 'center', label: 'Align center', icon: ALIGN_ICONS.center },
          { value: 'right', label: 'Align right', icon: ALIGN_ICONS.right },
        ]}
        onChange={(align) => onChange({ align }, 'align')}
      />
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <ToggleField label="Italic" checked={style.italic} onChange={(italic) => onChange({ italic }, 'italic')} />
        <ToggleField label="Uppercase" checked={style.uppercase} onChange={(uppercase) => onChange({ uppercase }, 'upper')} />
        <ToggleField label="Wrap lines" checked={style.wrap} onChange={(wrap) => onChange({ wrap }, 'wrap')} />
        <ToggleField label="Shrink to fit" checked={style.autoFit} onChange={(autoFit) => onChange({ autoFit }, 'fit')} />
      </div>
      {style.autoFit ? (
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Smallest size" unit="px" value={style.minFontSize} min={8} max={400} onChange={(minFontSize) => onChange({ minFontSize }, 'min')} />
          <NumberField label="Line limit" value={style.maxLines} min={0} max={20} onChange={(maxLines) => onChange({ maxLines }, 'lines')} hint="0 means no limit" />
        </div>
      ) : null}
      {showColor ? (
        <ColorField
          label="Color"
          value={style.color}
          resolved={colorNode?.color}
          allowAuto
          palette={palette}
          contrast={colorNode ? { ratio: colorNode.contrast, required: colorNode.requiredContrast, readable: colorNode.color } : undefined}
          onChange={(color) => onChange({ color }, 'color')}
        />
      ) : null}
    </div>
  )
}

/** Inspector for a text layer. */
export function TextPanel({ owner, layer, node }: { owner: LayerOwner; layer: TextLayer; node: SceneText | undefined }): React.JSX.Element {
  const api = useEditorApi()
  const patch = useLayerPatch(owner)
  const document = useEditor((state) => state.document)
  const locale = useEditor((state) => state.locale)
  const { slide, size } = useActiveScene()
  const baseWidth = useBaseWidth(node)
  const sourceLocale = document.localization.sourceLocale
  const localized = locale !== sourceLocale
  const [localeOnly, setLocaleOnly] = React.useState(true)
  const style = resolveTextStyle(layer, document.theme, locale)
  const shown = localizedContent(layer, locale, sourceLocale)
  const plain = shown.content.map((span) => span.text).join('')
  const editable = shown.content.length <= 1

  const writeStyle = (stylePatch: TextStyleOverrides, key: string) => {
    if (localized && localeOnly && owner.kind === 'slide') {
      api.getState().dispatch({ type: 'text.setLocaleOverride', slideId: slide.id, layerId: layer.id, locale, style: stylePatch }, { key: `locale-style:${layer.id}:${key}` })
      return
    }
    patch([layer.id], { style: stylePatch }, `style-${key}`)
  }

  const writeText = (text: string) => {
    const content = [{ ...(shown.content[0] ?? {}), text }]
    if (localized && owner.kind === 'slide') {
      api.getState().dispatch({ type: 'text.translate', entries: [{ slideId: slide.id, layerId: layer.id, locale, content, status: 'draft' }] }, { key: `text:${layer.id}:${locale}` })
    } else {
      patch([layer.id], { content }, `text-${locale}`)
    }
  }

  const translation = layer.translations[locale]
  return (
    <>
      <Section
        title={TEXT_ROLE_LABELS[layer.role]}
        actions={
          <button type="button" onClick={() => api.getState().startTextEdit(owner, layer.id)} className="h-7 rounded-md border border-foreground/10 px-2 text-[11px] hover:bg-foreground/[0.05]">
            Edit on canvas
          </button>
        }
      >
        {editable ? (
          <textarea
            aria-label={`${layer.name} text${localized ? ` (${locale})` : ''}`}
            value={plain}
            rows={3}
            maxLength={600}
            onChange={(event) => writeText(event.target.value)}
            className="w-full resize-y rounded-md border border-foreground/10 bg-foreground/[0.035] p-2 text-xs leading-relaxed outline-none focus:border-foreground/30"
          />
        ) : (
          <p className="rounded-md border border-foreground/10 bg-foreground/[0.025] p-2 text-[11px] leading-relaxed text-muted-foreground">
            “{plain}” has mixed formatting. Double-click it on the canvas to edit without losing the formatting.
          </p>
        )}
        <SelectField
          label="Role"
          value={layer.role}
          options={textRoleSchema.options.map((role) => ({ value: role, label: TEXT_ROLE_LABELS[role] }))}
          onChange={(role) => patch([layer.id], { role })}
        />
        {localized ? (
          <div className="space-y-2 rounded-md border border-foreground/10 bg-foreground/[0.025] p-2">
            <p className="text-[11px]">
              <span className="font-medium">{locale}:</span> {STATE_LABELS[shown.state]}
              {translation ? ` · ${translation.status}` : ''}
            </p>
            <p className="text-[10px] text-muted-foreground">Source: “{layer.content.map((span) => span.text).join('')}”</p>
            {translation && translation.status !== 'approved' ? (
              <button
                type="button"
                onClick={() => api.getState().dispatch({ type: 'text.setTranslationStatus', slideId: slide.id, layerId: layer.id, locale, status: 'approved' })}
                className="h-7 rounded-md bg-foreground px-2 text-[11px] text-background"
              >
                Approve translation
              </button>
            ) : null}
            {shown.state === 'outdated' ? (
              <button
                type="button"
                onClick={() => api.getState().dispatch({ type: 'text.setTranslationStatus', slideId: slide.id, layerId: layer.id, locale, status: 'approved' })}
                className="ml-2 h-7 rounded-md border border-foreground/10 px-2 text-[11px]"
              >
                Still correct
              </button>
            ) : null}
          </div>
        ) : null}
      </Section>
      <Section
        title="Typography"
        actions={
          <button type="button" onClick={() => api.getState().dispatch({ type: 'reset.text', owner, layerIds: [layer.id], scope: 'style' })} className="h-7 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-foreground/[0.05]" title="Return to the project style for this role">
            Reset style
          </button>
        }
      >
        {localized ? <ToggleField label={`Only for ${locale}`} checked={localeOnly} onChange={setLocaleOnly} hint="Adjust size and spacing for this language without changing the others." /> : null}
        <TypographyFields style={style} onChange={writeStyle} showColor colorNode={node} palette={document.theme.palette} />
      </Section>
      <Section title="Placement">
        <ChoiceField
          label="Positioned by"
          value={layer.placement.mode}
          options={[
            { value: 'auto', label: 'Layout' },
            { value: 'free', label: 'Free' },
          ]}
          onChange={(mode) => {
            if (mode === layer.placement.mode) return
            if (mode === 'auto') {
              patch([layer.id], { placement: { mode: 'auto', slot: layer.role === 'heading' ? 0 : layer.role === 'subheading' ? 1 : 2 }, transform: { offsetX: 0, offsetY: 0 } })
              return
            }
            const box = node?.box
            patch([layer.id], {
              placement: box
                ? {
                    mode: 'free',
                    x: roundTo(((box.x + box.width / 2) / baseWidth) * 100, 2),
                    y: roundTo(((box.y + box.height / 2) / size.height) * 100, 2),
                    width: roundTo((box.width / baseWidth) * 100, 2),
                  }
                : { mode: 'free', x: 50, y: 50, width: 80 },
              transform: { offsetX: 0, offsetY: 0 },
            })
          }}
        />
        <p className="text-[10px] leading-snug text-muted-foreground">
          Layout keeps text in the copy area above the device and reserves its space. Free text can go anywhere; overlaps are flagged in Checks.
        </p>
      </Section>
      <TransformSection owner={owner} layer={layer} node={node} />
      <LayerStateSection owner={owner} layer={layer} />
    </>
  )
}
