'use client'

import * as React from 'react'
import { ContextMenu } from 'radix-ui'
import { toast } from 'sonner'
import { MAX_PROJECT_SLIDES } from '@/lib/store-screenshots/commands/apply'
import { panoramaFor } from '@/lib/store-screenshots/engine/scene'
import { getStoreTargetOrDefault, targetPixelSize } from '@/lib/store-screenshots/targets'
import { cn } from '@/lib/utils'
import { useStudioActions } from './actions'
import { useEditor, useEditorApi } from './editor-store'
import { SlideThumbnail } from './SlideThumbnail'

/**
 * The slide strip. Click selects, Cmd/Ctrl-click toggles, Shift-click
 * selects a range. Dragging moves the whole selection; panorama groups move
 * as one block. Keyboard: arrows move focus, Alt+arrows move the slide,
 * Delete removes the selected slides, and the context menu (or Shift+F10)
 * offers duplicate, delete, and move.
 */

const THUMB_HEIGHT = 72

type Drag = { pointerId: number; startX: number; ids: string[]; active: boolean; dropIndex: number | null }

const menuItem = 'flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-foreground/[0.07] data-[disabled]:opacity-40'

/** The filmstrip. */
export function Filmstrip(): React.JSX.Element {
  const api = useEditorApi()
  const actions = useStudioActions()
  const document = useEditor((state) => state.document)
  const activeSlideId = useEditor((state) => state.activeSlideId)
  const selectedSlideIds = useEditor((state) => state.selectedSlideIds)
  const targetId = useEditor((state) => state.targetId)
  const locale = useEditor((state) => state.locale)
  const size = targetPixelSize(getStoreTargetOrDefault(targetId))
  const listRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<Drag | null>(null)
  const suppressClickRef = React.useRef(false)
  const [dropIndex, setDropIndex] = React.useState<number | null>(null)
  const [announcement, setAnnouncement] = React.useState('')
  const slides = document.slides
  const selected = new Set(selectedSlideIds)

  const deleteSlides = (ids: string[]) => {
    if (ids.length >= slides.length) {
      toast.error('A set needs at least one slide.', { description: 'Use Start over in the project menu to clear everything.' })
      return
    }
    api.getState().dispatch({ type: 'slides.delete', slideIds: ids })
    toast(`${ids.length === 1 ? 'Slide' : `${ids.length} slides`} deleted`, {
      action: { label: 'Undo', onClick: () => api.getState().undo() },
    })
  }

  const moveTo = (ids: string[], toIndex: number) => {
    const changed = api.getState().dispatch({ type: 'slides.move', slideIds: ids, toIndex })
    if (!changed) return
    const order = api.getState().document.slides.map((slide) => slide.id)
    setAnnouncement(`Moved to position ${order.indexOf(ids[0]) + 1} of ${order.length}.`)
    window.requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-slide-button="${ids[0]}"]`)?.focus())
  }

  const indexAmongRest = (ids: string[], index: number) => {
    const moving = new Set(ids)
    return slides.slice(0, index).filter((slide) => !moving.has(slide.id)).length
  }

  const dropIndexAt = (clientX: number): number => {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-slide-button]') ?? [])
    const index = buttons.findIndex((button) => {
      const rect = button.getBoundingClientRect()
      return clientX < rect.left + rect.width / 2
    })
    return index === -1 ? buttons.length : index
  }

  return (
    <div className="relative flex h-[104px] shrink-0 items-center gap-2 border-t border-foreground/10 bg-background px-3">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <p id="filmstrip-help" className="sr-only">
        Use Left and Right to move between slides, Alt with Left or Right to reorder, Shift or Command to select several, and Delete to remove.
      </p>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Slides"
        aria-multiselectable="true"
        aria-describedby="filmstrip-help"
        className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto py-3"
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag || drag.pointerId !== event.pointerId) return
          if (!drag.active && Math.abs(event.clientX - drag.startX) < 5) return
          drag.active = true
          drag.dropIndex = dropIndexAt(event.clientX)
          setDropIndex(drag.dropIndex)
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current
          dragRef.current = null
          setDropIndex(null)
          if (!drag || !drag.active || drag.dropIndex === null || drag.pointerId !== event.pointerId) return
          suppressClickRef.current = true
          moveTo(drag.ids, indexAmongRest(drag.ids, drag.dropIndex))
        }}
        onPointerCancel={() => {
          dragRef.current = null
          setDropIndex(null)
        }}
      >
        {slides.map((slide, index) => {
          const isActive = slide.id === activeSlideId
          const isSelected = selected.has(slide.id)
          const membership = panoramaFor(document, slide.id)
          return (
            <React.Fragment key={slide.id}>
              {dropIndex === index ? <span aria-hidden="true" className="h-16 w-0.5 shrink-0 rounded-full bg-[var(--canvas-selection,#3B82F6)]" /> : null}
              <ContextMenu.Root
                onOpenChange={(open) => {
                  if (open && !selected.has(slide.id)) api.getState().activateSlide(slide.id)
                }}
              >
                <ContextMenu.Trigger asChild>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    aria-current={isActive ? 'true' : undefined}
                    aria-label={`Slide ${index + 1} of ${slides.length}: ${slide.name}${membership ? `, panorama part ${membership.index + 1}` : ''}`}
                    data-slide-button={slide.id}
                    data-slide-id={slide.id}
                    tabIndex={isActive ? 0 : -1}
                    className={cn(
                      'relative shrink-0 touch-none select-none rounded-md outline-none transition-[box-shadow,opacity] focus-visible:ring-2 focus-visible:ring-foreground/40',
                      isActive ? 'ring-2 ring-[var(--canvas-selection,#3B82F6)]' : isSelected ? 'ring-2 ring-[var(--canvas-selection,#3B82F6)]/45' : 'opacity-70 hover:opacity-100'
                    )}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return
                      const ids = selected.has(slide.id) && !event.shiftKey && !event.metaKey && !event.ctrlKey ? selectedSlideIds : [slide.id]
                      dragRef.current = { pointerId: event.pointerId, startX: event.clientX, ids: slides.map((item) => item.id).filter((id) => ids.includes(id)), active: false, dropIndex: null }
                    }}
                    onClick={(event) => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false
                        return
                      }
                      if (event.shiftKey) api.getState().activateSlide(slide.id, 'range')
                      else if (event.metaKey || event.ctrlKey) api.getState().activateSlide(slide.id, 'toggle')
                      else api.getState().activateSlide(slide.id)
                    }}
                    onKeyDown={(event) => {
                      const focusAt = (target: number) => {
                        const next = slides[Math.max(0, Math.min(slides.length - 1, target))]
                        listRef.current?.querySelector<HTMLButtonElement>(`[data-slide-button="${next.id}"]`)?.focus()
                        return next
                      }
                      if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
                        event.preventDefault()
                        const ids = selected.has(slide.id) ? selectedSlideIds : [slide.id]
                        const rest = indexAmongRest(ids, index)
                        moveTo(ids, event.key === 'ArrowLeft' ? Math.max(0, rest - 1) : rest + 1)
                      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                        event.preventDefault()
                        const next = focusAt(index + (event.key === 'ArrowLeft' ? -1 : 1))
                        api.getState().activateSlide(next.id, event.shiftKey ? 'range' : 'replace')
                      } else if (event.key === 'Home' || event.key === 'End') {
                        event.preventDefault()
                        api.getState().activateSlide(focusAt(event.key === 'Home' ? 0 : slides.length - 1).id)
                      } else if (event.key === 'Delete' || event.key === 'Backspace') {
                        event.preventDefault()
                        deleteSlides(selected.has(slide.id) ? selectedSlideIds : [slide.id])
                      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
                        event.preventDefault()
                        api.getState().selectSlides(slides.map((item) => item.id))
                      }
                    }}
                  >
                    <SlideThumbnail document={document} index={index} size={size} targetId={targetId} locale={locale} height={THUMB_HEIGHT} className="rounded-md" />
                    <span className="absolute bottom-0.5 left-1 rounded bg-background/85 px-1 text-[9px] font-medium tabular-nums text-foreground">{index + 1}</span>
                    {membership ? (
                      <span
                        aria-hidden="true"
                        title="Panorama"
                        className={cn(
                          'absolute -bottom-1.5 h-1 bg-amber-500',
                          membership.index === 0 ? 'left-1 right-[-8px] rounded-l-full' : membership.index === membership.panorama.slideIds.length - 1 ? 'left-[-8px] right-1 rounded-r-full' : 'left-[-8px] right-[-8px]'
                        )}
                      />
                    ) : null}
                  </button>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content className="z-50 min-w-48 rounded-md border border-foreground/10 bg-background p-1 shadow-lg">
                    <ContextMenu.Item className={menuItem} disabled={slides.length + selectedSlideIds.length > MAX_PROJECT_SLIDES} onSelect={() => api.getState().dispatch({ type: 'slides.duplicate', slideIds: selectedSlideIds })}>
                      Duplicate {selectedSlideIds.length > 1 ? `${selectedSlideIds.length} slides` : 'slide'}
                    </ContextMenu.Item>
                    <ContextMenu.Item className={menuItem} onSelect={() => moveTo(selectedSlideIds, 0)}>
                      Move to start
                    </ContextMenu.Item>
                    <ContextMenu.Item className={menuItem} onSelect={() => moveTo(selectedSlideIds, Math.max(0, indexAmongRest(selectedSlideIds, index) - 1))}>
                      Move left
                    </ContextMenu.Item>
                    <ContextMenu.Item className={menuItem} onSelect={() => moveTo(selectedSlideIds, indexAmongRest(selectedSlideIds, index) + 1)}>
                      Move right
                    </ContextMenu.Item>
                    <ContextMenu.Item className={menuItem} onSelect={() => moveTo(selectedSlideIds, slides.length)}>
                      Move to end
                    </ContextMenu.Item>
                    <ContextMenu.Separator className="my-1 h-px bg-foreground/10" />
                    <ContextMenu.Item className={menuItem} onSelect={() => actions.openDialog('applyStyle')}>
                      Apply style from active slide…
                    </ContextMenu.Item>
                    <ContextMenu.Item className={menuItem} onSelect={() => api.getState().selectSlides(slides.map((item) => item.id))}>
                      Select all slides
                    </ContextMenu.Item>
                    <ContextMenu.Separator className="my-1 h-px bg-foreground/10" />
                    <ContextMenu.Item className={cn(menuItem, 'text-destructive')} onSelect={() => deleteSlides(selectedSlideIds)}>
                      Delete {selectedSlideIds.length > 1 ? `${selectedSlideIds.length} slides` : 'slide'}
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            </React.Fragment>
          )
        })}
        {dropIndex === slides.length ? <span aria-hidden="true" className="h-16 w-0.5 shrink-0 rounded-full bg-[var(--canvas-selection,#3B82F6)]" /> : null}
        <button
          type="button"
          disabled={slides.length >= MAX_PROJECT_SLIDES}
          onClick={() => actions.openDialog('import')}
          aria-label="Add slides"
          title="Add slides from screenshots"
          className="flex h-[72px] w-[34px] shrink-0 items-center justify-center rounded-md border border-dashed border-foreground/20 text-lg text-muted-foreground hover:bg-foreground/[0.04] disabled:opacity-40"
        >
          +
        </button>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-[10px] text-muted-foreground">
        <span className="tabular-nums">
          {selectedSlideIds.length > 1 ? `${selectedSlideIds.length} of ` : ''}
          {slides.length} slides
        </span>
        {selectedSlideIds.length > 1 ? (
          <button type="button" onClick={() => api.getState().activateSlide(activeSlideId)} className="underline underline-offset-2">
            Clear selection
          </button>
        ) : null}
      </div>
    </div>
  )
}
