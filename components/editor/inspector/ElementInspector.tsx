'use client'

import * as React from 'react'
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Copy01Icon,
  Delete02Icon,
  LockIcon,
  ViewIcon,
  ViewOffSlashIcon,
} from 'hugeicons-react'
import { Slider } from '@/components/ui/slider'
import {
  badgeNumberingSchema,
  badgeShapeSchema,
  calloutShapeSchema,
  type CanvasElement,
  cursorKindSchema,
  type ElementOf,
  spotlightShapeSchema,
} from '@/lib/editor/elements/schema'
import { useImageStore } from '@/lib/store'
import type { ElementChanges } from '@/lib/store/elements-slice'
import { SectionWrapper } from '../sections'
import { ChoiceField, ColorField, ToggleField } from './fields'

/** Display names of element types. */
export const ELEMENT_LABELS: Record<CanvasElement['type'], string> = {
  badge: 'Step badge',
  callout: 'Zoom callout',
  cursor: 'Cursor',
  spotlight: 'Spotlight',
}

const percent = (value: number) => `${Math.round(value * 100)}%`
const capitalized = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
const choices = <Value extends string>(values: readonly Value[]) =>
  values.map((value) => ({ label: capitalized(value), value }))

type Update<Element extends CanvasElement> = (changes: ElementChanges & { props?: Partial<Element['props']> }) => void

function ShadowToggle({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
  return <ToggleField checked={enabled} label="Shadow" onChange={onChange} />
}

function BadgeFields({ element, update }: { element: ElementOf<'badge'>; update: Update<ElementOf<'badge'>> }) {
  const { props } = element
  return (
    <>
      <Slider
        label="Number"
        max={99}
        min={1}
        onValueChange={([number]) => update({ props: { number } })}
        step={1}
        value={[props.number]}
        valueDisplay={String(props.number)}
      />
      <ChoiceField
        label="Numbering"
        onChange={(numbering) => update({ props: { numbering } })}
        options={[
          { label: '1 2 3', value: badgeNumberingSchema.enum.numeric },
          { label: 'A B C', value: badgeNumberingSchema.enum.alpha },
          { label: 'I II III', value: badgeNumberingSchema.enum.roman },
        ]}
        value={props.numbering}
      />
      <ChoiceField
        label="Shape"
        onChange={(shape) => update({ props: { shape } })}
        options={choices(badgeShapeSchema.options)}
        value={props.shape}
      />
      <ColorField label="Fill" onChange={(background) => update({ props: { background } })} value={props.background} />
      <ColorField label="Number" onChange={(color) => update({ props: { color } })} value={props.color} />
      <ColorField label="Border" onChange={(borderColor) => update({ props: { borderColor } })} value={props.borderColor} />
      <Slider
        label="Border width"
        max={12}
        min={0}
        onValueChange={([borderWidth]) => update({ props: { borderWidth } })}
        step={1}
        value={[props.borderWidth]}
        valueDisplay={`${props.borderWidth}px`}
      />
      <ShadowToggle
        enabled={props.shadow.enabled}
        onChange={(enabled) => update({ props: { shadow: { ...props.shadow, enabled } } })}
      />
    </>
  )
}

function CursorFields({ element, update }: { element: ElementOf<'cursor'>; update: Update<ElementOf<'cursor'>> }) {
  const { props } = element
  return (
    <>
      <ChoiceField
        label="Pointer"
        onChange={(kind) => update({ props: { kind } })}
        options={choices(cursorKindSchema.options)}
        value={props.kind}
      />
      <ColorField label="Fill" onChange={(fill) => update({ props: { fill } })} value={props.fill} />
      <ColorField label="Outline" onChange={(stroke) => update({ props: { stroke } })} value={props.stroke} />
      <ToggleField
        checked={props.click.enabled}
        label="Click ring"
        onChange={(enabled) => update({ props: { click: { ...props.click, enabled } } })}
      />
      {props.click.enabled ? (
        <>
          <ColorField
            label="Ring color"
            onChange={(color) => update({ props: { click: { ...props.click, color } } })}
            value={props.click.color}
          />
          <Slider
            label="Ring size"
            max={4}
            min={0.5}
            onValueChange={([size]) => update({ props: { click: { ...props.click, size } } })}
            step={0.1}
            value={[props.click.size]}
            valueDisplay={`${props.click.size.toFixed(1)}×`}
          />
        </>
      ) : null}
      <ShadowToggle
        enabled={props.shadow.enabled}
        onChange={(enabled) => update({ props: { shadow: { ...props.shadow, enabled } } })}
      />
    </>
  )
}

function SpotlightFields({
  element,
  update,
}: {
  element: ElementOf<'spotlight'>
  update: Update<ElementOf<'spotlight'>>
}) {
  const { props } = element
  return (
    <>
      <ChoiceField
        label="Shape"
        onChange={(shape) => update({ props: { shape } })}
        options={choices(spotlightShapeSchema.options)}
        value={props.shape}
      />
      <Slider
        label="Dim surroundings"
        max={1}
        min={0}
        onValueChange={([dim]) => update({ props: { dim } })}
        step={0.01}
        value={[props.dim]}
        valueDisplay={percent(props.dim)}
      />
      <Slider
        label="Feather"
        max={1}
        min={0}
        onValueChange={([feather]) => update({ props: { feather } })}
        step={0.01}
        value={[props.feather]}
        valueDisplay={percent(props.feather)}
      />
      {props.shape === 'rectangle' ? (
        <Slider
          label="Corner radius"
          max={0.5}
          min={0}
          onValueChange={([radius]) => update({ props: { radius } })}
          step={0.01}
          value={[props.radius]}
          valueDisplay={percent(props.radius * 2)}
        />
      ) : null}
      <ColorField label="Dim color" onChange={(color) => update({ props: { color } })} value={props.color} />
    </>
  )
}

function CalloutFields({ element, update }: { element: ElementOf<'callout'>; update: Update<ElementOf<'callout'>> }) {
  const { props } = element
  return (
    <>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Drag the dashed box on the screenshot to choose what to magnify.
      </p>
      <Slider
        label="Zoom"
        max={10}
        min={1}
        onValueChange={([zoom]) => update({ props: { zoom } })}
        step={0.1}
        value={[props.zoom]}
        valueDisplay={`${props.zoom.toFixed(1)}×`}
      />
      <ChoiceField
        label="Shape"
        onChange={(shape) => update({ props: { shape } })}
        options={choices(calloutShapeSchema.options)}
        value={props.shape}
      />
      {props.shape === 'rounded' ? (
        <Slider
          label="Corner radius"
          max={0.5}
          min={0}
          onValueChange={([radius]) => update({ props: { radius } })}
          step={0.01}
          value={[props.radius ?? 0.12]}
          valueDisplay={percent((props.radius ?? 0.12) * 2)}
        />
      ) : null}
      <ColorField label="Border" onChange={(borderColor) => update({ props: { borderColor } })} value={props.borderColor} />
      <Slider
        label="Border width"
        max={24}
        min={0}
        onValueChange={([borderWidth]) => update({ props: { borderWidth } })}
        step={1}
        value={[props.borderWidth]}
        valueDisplay={`${props.borderWidth}px`}
      />
      <ToggleField checked={props.connector} label="Connector line" onChange={(connector) => update({ props: { connector } })} />
      <ToggleField checked={props.showSource} label="Outline source" onChange={(showSource) => update({ props: { showSource } })} />
      <ShadowToggle
        enabled={props.shadow.enabled}
        onChange={(enabled) => update({ props: { shadow: { ...props.shadow, enabled } } })}
      />
    </>
  )
}

function ArrangeButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      className="grid h-8 flex-1 place-items-center rounded-md border border-foreground/10 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

/** Properties of the selected composition element. */
export function ElementInspector({ id }: { id: string }) {
  const element = useImageStore((state) => state.elements.find((item) => item.id === id))
  const updateElement = useImageStore((state) => state.updateElement)
  const removeElement = useImageStore((state) => state.removeElement)
  const duplicateElement = useImageStore((state) => state.duplicateElement)
  const reorderElement = useImageStore((state) => state.reorderElement)
  if (!element) return null
  const update = (changes: ElementChanges) => updateElement(id, changes)

  return (
    <>
      <SectionWrapper defaultOpen title={ELEMENT_LABELS[element.type]}>
        <div className="space-y-3">
          {element.type === 'badge' ? <BadgeFields element={element} update={update} /> : null}
          {element.type === 'cursor' ? <CursorFields element={element} update={update} /> : null}
          {element.type === 'spotlight' ? <SpotlightFields element={element} update={update} /> : null}
          {element.type === 'callout' ? <CalloutFields element={element} update={update} /> : null}
        </div>
      </SectionWrapper>
      <SectionWrapper defaultOpen={false} title="Arrange">
        <div className="space-y-3">
          <Slider
            label="Rotation"
            max={180}
            min={-180}
            onValueChange={([rotation]) => update({ rotation })}
            step={1}
            value={[element.rotation]}
            valueDisplay={`${element.rotation}°`}
          />
          <Slider
            label="Opacity"
            max={1}
            min={0}
            onValueChange={([opacity]) => update({ opacity })}
            step={0.01}
            value={[element.opacity]}
            valueDisplay={percent(element.opacity)}
          />
          <div className="flex gap-1.5">
            <ArrangeButton label="Bring forward" onClick={() => reorderElement(id, 'up')}>
              <ArrowUp01Icon size={14} />
            </ArrangeButton>
            <ArrangeButton label="Send backward" onClick={() => reorderElement(id, 'down')}>
              <ArrowDown01Icon size={14} />
            </ArrangeButton>
            <ArrangeButton label={element.visible ? 'Hide' : 'Show'} onClick={() => update({ visible: !element.visible })}>
              {element.visible ? <ViewIcon size={14} /> : <ViewOffSlashIcon size={14} />}
            </ArrangeButton>
            <ArrangeButton label={element.locked ? 'Unlock' : 'Lock'} onClick={() => update({ locked: !element.locked })}>
              <LockIcon size={14} className={element.locked ? 'text-foreground' : undefined} />
            </ArrangeButton>
            <ArrangeButton label="Duplicate" onClick={() => duplicateElement(id)}>
              <Copy01Icon size={14} />
            </ArrangeButton>
            <ArrangeButton label="Delete" onClick={() => removeElement(id)}>
              <Delete02Icon size={14} />
            </ArrangeButton>
          </div>
        </div>
      </SectionWrapper>
    </>
  )
}
