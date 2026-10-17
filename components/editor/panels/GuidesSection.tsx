'use client'

import * as React from 'react'
import { Slider } from '@/components/ui/slider'
import { SAFE_ZONES } from '@/lib/editor/snapping'
import { type SafeZone, safeZoneSchema, useCanvasGuides } from '@/lib/store/canvas-guides'
import { ToggleField } from '../inspector/fields'
import { SectionWrapper } from '../sections'

/** Snapping and composition guides. Guides never reach exports unless asked to. */
export function GuidesSection() {
  const guides = useCanvasGuides()
  const zoneNote = guides.safeZone === 'none' ? null : SAFE_ZONES[guides.safeZone].note
  return (
    <SectionWrapper defaultOpen={false} title="Guides & snapping">
      <div className="space-y-3">
        <ToggleField checked={guides.snapping} label="Snap while dragging" onChange={(snapping) => guides.setGuides({ snapping })} />
        {guides.snapping ? (
          <>
            <ToggleField
              checked={guides.snapToCanvas}
              label="To canvas edges and centre"
              onChange={(snapToCanvas) => guides.setGuides({ snapToCanvas })}
            />
            <ToggleField
              checked={guides.snapToObjects}
              label="To other layers"
              onChange={(snapToObjects) => guides.setGuides({ snapToObjects })}
            />
            <Slider
              label="Snap distance"
              max={20}
              min={2}
              onValueChange={([snapTolerance]) => guides.setGuides({ snapTolerance })}
              step={1}
              value={[guides.snapTolerance]}
              valueDisplay={`${guides.snapTolerance}px`}
            />
          </>
        ) : null}
        <ToggleField checked={guides.showThirds} label="Rule of thirds" onChange={(showThirds) => guides.setGuides({ showThirds })} />
        <label className="block space-y-1.5">
          <span className="text-xs text-muted-foreground">Safe zone</span>
          <select
            className="h-8 w-full rounded-md border border-foreground/10 bg-background px-2 text-xs"
            onChange={(event) => guides.setGuides({ safeZone: safeZoneSchema.parse(event.target.value) })}
            value={guides.safeZone}
          >
            <option value={safeZoneSchema.enum.none}>None</option>
            {(Object.keys(SAFE_ZONES) as Exclude<SafeZone, 'none'>[]).map((zone) => (
              <option key={zone} value={zone}>
                {SAFE_ZONES[zone].label}
              </option>
            ))}
          </select>
        </label>
        {zoneNote ? <p className="text-[11px] leading-snug text-muted-foreground">{zoneNote} Approximate; platforms change their layouts.</p> : null}
        <ToggleField
          checked={guides.guidesInExport}
          label="Include guides in exports"
          onChange={(guidesInExport) => guides.setGuides({ guidesInExport })}
        />
      </div>
    </SectionWrapper>
  )
}
