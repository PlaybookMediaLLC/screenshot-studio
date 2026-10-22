'use client'

import * as React from 'react'
import { PiDotsSixVertical as DragDropVerticalIcon, PiEye as ViewIcon, PiEyeSlash as ViewOffSlashIcon } from 'react-icons/pi'
import { SectionWrapper } from '@/components/editor/sections/SectionWrapper'
import { selectScreen } from '@/lib/editor/selection'
import { isScreenScene, moveScreen } from '@/lib/frames/commands'
import { contentLabel, frameLabel, screenLabel } from '@/lib/frames/labels'
import { useImageStore } from '@/lib/store'
import { useDeviceUIStore } from '@/lib/store/device-ui'
import { useEditorPanels } from '@/lib/store/editor-panels'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * The composition's screens in the Layers panel, top to bottom. Drag a row
 * (or press Alt with an arrow key) to change the stacking order; click to
 * select it and edit it.
 */
export function ScreenLayerList() {
  const scene = useImageStore(isScreenScene)
  const mockups = useImageStore((state) => state.mockups)
  const updateMockup = useImageStore((state) => state.updateMockup)
  const uploadedImageUrl = useImageStore((state) => state.uploadedImageUrl)
  const selectedId = useDeviceUIStore((state) => state.selectedDeviceId)
  const [dragging, setDragging] = React.useState<string | null>(null)
  const [target, setTarget] = React.useState<number | null>(null)
  if (!scene) return null

  const rows = [...mockups].reverse()
  const stackIndex = (row: number) => mockups.length - 1 - row
  const select = (id: string) => {
    selectScreen(id)
    useEditorPanels.getState().showTab('edit')
  }
  const finish = () => {
    setDragging(null)
    setTarget(null)
  }

  return (
    <SectionWrapper
      action={
        <span className="text-[10px] tabular-nums text-muted-foreground">{mockups.length}</span>
      }
      defaultOpen
      title="Screens"
    >
      <ul aria-label="Screens, top to bottom" className="space-y-0.5" data-local-dropzone="true">
        {rows.map((mockup, row) => {
          const selected = mockup.id === selectedId
          const thumbnail = mockup.screen.code ? null : (mockup.screen.src ?? uploadedImageUrl)
          return (
            <li
              className={cn(
                'rounded-md transition-colors',
                target === row && dragging && dragging !== mockup.id && 'ring-1 ring-primary/70',
                dragging === mockup.id && 'opacity-50'
              )}
              data-screen-layer={mockup.id}
              draggable
              key={mockup.id}
              onDragEnd={finish}
              onDragOver={(event) => {
                if (!dragging) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setTarget(row)
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', mockup.id)
                setDragging(mockup.id)
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (dragging) moveScreen(dragging, stackIndex(row))
                finish()
              }}
            >
              <div
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                aria-label={`${screenLabel(mockup)}, layer ${row + 1} of ${rows.length}`}
                aria-pressed={selected}
                className={cn(
                  'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
                  selected ? 'bg-foreground/[0.06]' : 'hover:bg-foreground/[0.04]'
                )}
                onClick={() => select(mockup.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                    event.preventDefault()
                    moveScreen(mockup.id, stackIndex(row) + (event.key === 'ArrowUp' ? 1 : -1))
                  } else if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    select(mockup.id)
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <DragDropVerticalIcon
                  aria-hidden="true"
                  className="shrink-0 cursor-grab text-muted-foreground/60"
                  size={14}
                />
                <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded border border-foreground/10 bg-foreground/[0.06] text-[9px] text-muted-foreground">
                  {thumbnail ? (
                    <img
                      alt=""
                      className="size-full object-cover"
                      draggable={false}
                      src={thumbnail}
                    />
                  ) : (
                    '</>'
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-foreground/85">
                    {contentLabel(mockup)}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {frameLabel(mockup)}
                  </span>
                </span>
                <Button variant="custom" size={null}
                  aria-label={mockup.isVisible ? 'Hide screen' : 'Show screen'}
                  className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation()
                    updateMockup(mockup.id, { isVisible: !mockup.isVisible })
                  }}
                  type="button"
                >
                  {mockup.isVisible ? <ViewIcon size={13} /> : <ViewOffSlashIcon size={13} />}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      <p className="mt-1 px-2 text-[10px] text-muted-foreground">
        Drag to reorder, or press Alt with ↑ or ↓.
      </p>
    </SectionWrapper>
  )
}
