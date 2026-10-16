'use client'

import * as React from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { slideScopeSchema, styleGroupSchema, type SlideScope, type StyleGroup } from '@/lib/store-screenshots/commands/schema'
import { cn } from '@/lib/utils'
import { useEditor, useEditorApi } from '../editor-store'
import { SHORTCUTS } from '../shortcuts'

/** Props shared by studio dialogs. */
export type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void }

/** The keyboard shortcuts reference. */
export function ShortcutsDialog({ open, onOpenChange }: DialogProps): React.JSX.Element {
  const groups = [...new Set(SHORTCUTS.map((shortcut) => shortcut.group))]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>On Windows and Linux, use Ctrl where you see ⌘ and Alt where you see ⌥.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {groups.map((group) => (
            <section key={group}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{group}</h3>
              <dl className="space-y-1.5">
                {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                  <div key={shortcut.action} className="flex items-baseline justify-between gap-3 text-xs">
                    <dt className="text-foreground">{shortcut.action}</dt>
                    <dd>
                      <kbd className="rounded border border-foreground/15 bg-foreground/[0.04] px-1.5 py-0.5 font-mono text-[10px]">{shortcut.keys}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Confirm resetting the whole active slide. */
export function ResetSlideDialog({ open, onOpenChange }: DialogProps): React.JSX.Element {
  const api = useEditorApi()
  const slide = useEditor((state) => state.document.slides.find((item) => item.id === state.activeSlideId))
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset {slide?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Positions, rotations, crops, text styles, layout, background, and size-specific adjustments on this slide go back to the project defaults. Your text and screenshots stay. You can undo this.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => slide && api.getState().dispatch({ type: 'reset.slide', slideId: slide.id })}>Reset slide</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const GROUP_LABELS: Record<StyleGroup, { label: string; hint: string }> = {
  background: { label: 'Background', hint: 'Color, gradient, or image' },
  layout: { label: 'Layout', hint: 'Where copy and devices sit' },
  typography: { label: 'Typography', hint: 'Font, size, weight, spacing' },
  textColors: { label: 'Text colors', hint: 'Heading and text colors' },
  textPosition: { label: 'Text positions', hint: 'Manual text moves' },
  deviceFrame: { label: 'Device frame', hint: 'Model, finish, and style' },
  devicePlacement: { label: 'Device position', hint: 'Moves, size, rotation, tilt' },
  screenFraming: { label: 'Screenshot crop', hint: 'Crop and adjustments' },
}

/** Copy chosen style groups from the active slide to a scope of slides, as one undo step. */
export function ApplyStyleDialog({ open, onOpenChange }: DialogProps): React.JSX.Element {
  const api = useEditorApi()
  const document = useEditor((state) => state.document)
  const activeSlideId = useEditor((state) => state.activeSlideId)
  const selectedSlideIds = useEditor((state) => state.selectedSlideIds)
  const [groups, setGroups] = React.useState<StyleGroup[]>(['background', 'typography', 'textColors'])
  const [scope, setScope] = React.useState<SlideScope>(selectedSlideIds.length > 1 ? 'selected' : 'all')
  const source = document.slides.find((slide) => slide.id === activeSlideId)
  const targets = (scope === 'all' ? document.slides.map((slide) => slide.id) : selectedSlideIds).filter((id) => id !== activeSlideId)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Apply style from “{source?.name}”</DialogTitle>
          <DialogDescription>Only the properties you tick are copied. Text, screenshots, and anything unticked stay as they are on each slide.</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium">Apply to</legend>
          {slideScopeSchema.exclude(['active']).options.map((value) => (
            <label key={value} className="flex items-center gap-2 text-xs">
              <input type="radio" name="apply-scope" checked={scope === value} onChange={() => setScope(value)} disabled={value === 'selected' && selectedSlideIds.length < 2} />
              {value === 'all' ? `All slides (${document.slides.length - 1} others)` : `Selected slides (${Math.max(0, selectedSlideIds.length - 1)} others)`}
            </label>
          ))}
        </fieldset>
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="mb-1 text-xs font-medium">Properties</legend>
          {styleGroupSchema.options.map((group) => (
            <label key={group} className={cn('flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs', groups.includes(group) ? 'border-foreground/30 bg-foreground/[0.05]' : 'border-foreground/10')}>
              <input type="checkbox" checked={groups.includes(group)} onChange={(event) => setGroups(event.target.checked ? [...groups, group] : groups.filter((item) => item !== group))} className="mt-0.5" />
              <span>
                <span className="block font-medium">{GROUP_LABELS[group].label}</span>
                <span className="block text-[10px] text-muted-foreground">{GROUP_LABELS[group].hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={groups.length === 0 || targets.length === 0 || !source}
            onClick={() => {
              api.getState().dispatch({ type: 'slides.applyStyle', sourceSlideId: source!.id, slideIds: targets, groups })
              onOpenChange(false)
            }}
          >
            Apply to {targets.length} {targets.length === 1 ? 'slide' : 'slides'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
