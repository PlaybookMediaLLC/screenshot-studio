'use client'

import * as React from 'react'
import { PiCircle as CircleIcon, PiCursor as Cursor01Icon, PiSun as Sun01Icon, PiMagnifyingGlassPlus as ZoomInAreaIcon } from 'react-icons/pi'
import { ELEMENT_LABELS } from '@/components/editor/inspector/ElementInspector'
import { createElement, type ElementType, nextBadgeNumber } from '@/lib/editor/elements/schema'
import { useImageStore } from '@/lib/store'
import { useEditorPanels } from '@/lib/store/editor-panels'
import { SectionWrapper } from './SectionWrapper'
import { Button } from '@/components/ui/button'

const INSERTABLE: { hint: string; icon: React.ReactNode; type: ElementType }[] = [
  { hint: 'A numbered step marker', icon: <CircleIcon size={16} />, type: 'badge' },
  { hint: 'A mouse pointer, with an optional click ring', icon: <Cursor01Icon size={16} />, type: 'cursor' },
  { hint: 'Dim everything but one area', icon: <Sun01Icon size={16} />, type: 'spotlight' },
  { hint: 'Magnify part of the rendered canvas', icon: <ZoomInAreaIcon size={16} />, type: 'callout' },
]

/** Add a composition element at the centre of the canvas and edit it in the inspector. */
export function insertElement(type: ElementType) {
  const state = useImageStore.getState()
  const canvas = state.canvasDimensions
  const aspect = canvas ? canvas.canvasW / canvas.canvasH : 4 / 3
  const badges = state.elements.filter((element) => element.type === 'badge').length
  state.addElement(
    createElement(type, {
      aspect,
      id: `element-${crypto.randomUUID()}`,
      number: nextBadgeNumber(state.elements),
      // Each new badge steps right so a sequence does not stack.
      x: type === 'badge' ? Math.min(0.9, 0.35 + badges * 0.08) : undefined,
    })
  )
  useEditorPanels.getState().showTab('edit')
}

/** Insert step badges, cursors, spotlights, and zoom callouts. */
export function ElementsSection() {
  return (
    <SectionWrapper title="Elements" defaultOpen>
      <div className="grid grid-cols-2 gap-1.5">
        {INSERTABLE.map(({ hint, icon, type }) => (
          <Button variant="custom" size={null}
            className="flex flex-col items-center gap-1.5 rounded-md border border-foreground/10 bg-foreground/[0.03] px-2 py-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-foreground/[0.06] hover:text-foreground"
            key={type}
            onClick={() => insertElement(type)}
            title={hint}
            type="button"
          >
            {icon}
            {ELEMENT_LABELS[type]}
          </Button>
        ))}
      </div>
    </SectionWrapper>
  )
}
