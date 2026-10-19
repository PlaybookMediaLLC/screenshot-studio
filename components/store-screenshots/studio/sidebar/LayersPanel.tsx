'use client'

import * as React from 'react'
import { ContextMenu } from 'radix-ui'
import type { ArrangeMove, LayerOwner } from '@/lib/store-screenshots/commands/schema'
import type { StoreLayer } from '@/lib/store-screenshots/document/schema'
import { panoramaFor } from '@/lib/store-screenshots/engine/scene'
import { cn } from '@/lib/utils'
import { useActiveScene } from '../active-scene'
import { useEditor, useEditorApi } from '../editor-store'

/**
 * The layer list for the active slide, top of the stack first. Selection is
 * the editor's selection, so the list, the canvas, and the inspector always
 * agree. Rows can be renamed (double-click), hidden, locked, reordered by
 * drag or Alt+Up/Down, grouped, duplicated, and deleted.
 */

const TYPE_GLYPHS: Record<StoreLayer['type'], string> = { text: 'T', device: '▯', image: '◩', annotation: '★', callout: '◎' }
const menuItem = 'flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-foreground/[0.07]'

function LayerRow({
  owner,
  layer,
  selected,
  hiddenByLayout,
  index,
  count,
  onDragStart,
}: {
  owner: LayerOwner
  layer: StoreLayer
  selected: boolean
  hiddenByLayout: boolean
  index: number
  count: number
  onDragStart: (event: React.PointerEvent, layerId: string) => void
}): React.JSX.Element {
  const api = useEditorApi()
  const selection = useEditor((state) => state.selection)
  const [renaming, setRenaming] = React.useState(false)
  const ids = selected && selection ? selection.layerIds : [layer.id]
  const arrange = (move: ArrangeMove) => api.getState().dispatch({ type: 'layers.arrange', owner, layerIds: ids, move })

  return (
    <ContextMenu.Root
      onOpenChange={(open) => {
        if (open && !selected) api.getState().selectLayers(owner, [layer.id], 'replace', { deep: true })
      }}
    >
      <ContextMenu.Trigger asChild>
        <div
          role="option"
          aria-selected={selected}
          tabIndex={selected || (!selection?.layerIds.length && index === 0) ? 0 : -1}
          data-layer-row={layer.id}
          className={cn(
            'group flex h-8 items-center gap-1.5 rounded-md px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-foreground/30',
            selected ? 'bg-[var(--canvas-selection,#3B82F6)]/15 text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground'
          )}
          onPointerDown={(event) => onDragStart(event, layer.id)}
          onClick={(event) => api.getState().selectLayers(owner, [layer.id], event.shiftKey || event.metaKey || event.ctrlKey ? 'toggle' : 'replace', { deep: true })}
          onDoubleClick={() => setRenaming(true)}
          onKeyDown={(event) => {
            if (renaming) return
            const rows = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[data-layer-row]') ?? [])
            const position = rows.indexOf(event.currentTarget)
            if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
              event.preventDefault()
              arrange(event.key === 'ArrowUp' ? 'forward' : 'backward')
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              const next = rows[position + (event.key === 'ArrowUp' ? -1 : 1)]
              if (next) {
                next.focus()
                api.getState().selectLayers(owner, [next.dataset.layerRow!], event.shiftKey ? 'add' : 'replace', { deep: true })
              }
            } else if (event.key === ' ') {
              event.preventDefault()
              api.getState().selectLayers(owner, [layer.id], event.shiftKey ? 'toggle' : 'replace', { deep: true })
            } else if (event.key === 'Enter' || event.key === 'F2') {
              event.preventDefault()
              setRenaming(true)
            } else if (event.key === 'Delete' || event.key === 'Backspace') {
              event.preventDefault()
              api.getState().dispatch({ type: 'layers.delete', owner, layerIds: ids })
            }
          }}
        >
          <span aria-hidden="true" className="w-4 shrink-0 text-center text-[11px] opacity-70">
            {TYPE_GLYPHS[layer.type]}
          </span>
          {layer.groupId ? <span aria-hidden="true" className="h-4 w-0.5 shrink-0 rounded bg-violet-400" title="Grouped" /> : null}
          {renaming ? (
            <input
              autoFocus
              defaultValue={layer.name}
              aria-label="Layer name"
              maxLength={80}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onBlur={(event) => {
                const name = event.target.value.trim()
                if (name && name !== layer.name) api.getState().dispatch({ type: 'layers.patch', owner, layerIds: [layer.id], patch: { name } })
                setRenaming(false)
              }}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') setRenaming(false)
              }}
              className="h-6 min-w-0 flex-1 rounded border border-foreground/20 bg-background px-1 text-xs outline-none"
            />
          ) : (
            <span className={cn('min-w-0 flex-1 truncate', (layer.hidden || hiddenByLayout) && 'opacity-50')}>{layer.name}</span>
          )}
          {hiddenByLayout ? <span className="shrink-0 text-[9px] text-amber-600" title="This layout shows fewer devices; the device is kept">not in layout</span> : null}
          <button
            type="button"
            aria-label={layer.hidden ? `Show ${layer.name}` : `Hide ${layer.name}`}
            title={layer.hidden ? 'Show' : 'Hide'}
            aria-pressed={layer.hidden}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              api.getState().dispatch({ type: 'layers.patch', owner, layerIds: [layer.id], patch: { hidden: !layer.hidden } })
            }}
            className={cn('flex size-6 shrink-0 items-center justify-center rounded hover:bg-foreground/[0.08]', !layer.hidden && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              {layer.hidden ? <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.9 8.4 2 12 2 12s4 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /> : <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />}
            </svg>
          </button>
          <button
            type="button"
            aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
            title={layer.locked ? 'Unlock' : 'Lock'}
            aria-pressed={layer.locked}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              api.getState().dispatch({ type: 'layers.patch', owner, layerIds: [layer.id], patch: { locked: !layer.locked } })
            }}
            className={cn('flex size-6 shrink-0 items-center justify-center rounded hover:bg-foreground/[0.08]', !layer.locked && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d={layer.locked ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.5-2'} />
            </svg>
          </button>
          <span className="sr-only">
            Layer {count - index} of {count}
          </span>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-44 rounded-md border border-foreground/10 bg-background p-1 shadow-lg">
          <ContextMenu.Item className={menuItem} onSelect={() => setRenaming(true)}>
            Rename
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItem} onSelect={() => api.getState().dispatch({ type: 'layers.duplicate', owner, layerIds: ids, placements: {} })}>
            Duplicate
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-foreground/10" />
          <ContextMenu.Item className={menuItem} onSelect={() => arrange('front')}>
            Bring to front
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItem} onSelect={() => arrange('forward')}>
            Bring forward
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItem} onSelect={() => arrange('backward')}>
            Send backward
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItem} onSelect={() => arrange('back')}>
            Send to back
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-foreground/10" />
          {ids.length > 1 ? (
            <ContextMenu.Item className={menuItem} onSelect={() => api.getState().dispatch({ type: 'layers.group', owner, layerIds: ids, groupId: crypto.randomUUID() })}>
              Group
            </ContextMenu.Item>
          ) : null}
          {layer.groupId ? (
            <ContextMenu.Item className={menuItem} onSelect={() => api.getState().dispatch({ type: 'layers.ungroup', owner, layerIds: ids })}>
              Ungroup
            </ContextMenu.Item>
          ) : null}
          <ContextMenu.Item className={cn(menuItem, 'text-destructive')} onSelect={() => api.getState().dispatch({ type: 'layers.delete', owner, layerIds: ids })}>
            Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

function LayerList({ owner, layers, title }: { owner: LayerOwner; layers: StoreLayer[]; title: string }): React.JSX.Element {
  const api = useEditorApi()
  const selection = useEditor((state) => state.selection)
  const { scene } = useActiveScene()
  const outOfLayout = new Set(scene?.hidden.filter((item) => item.reason === 'layout').map((item) => item.layerId))
  const listRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<{ pointerId: number; layerId: string; startY: number; active: boolean } | null>(null)
  const [dropAt, setDropAt] = React.useState<number | null>(null)
  const topFirst = [...layers].reverse()
  const selected = new Set(selection?.owner.id === owner.id ? selection.layerIds : [])

  const rowIndexAt = (clientY: number) => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-layer-row]') ?? [])
    const index = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect()
      return clientY < rect.top + rect.height / 2
    })
    return index === -1 ? rows.length : index
  }

  return (
    <div className="space-y-1">
      <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{title}</p>
      <div
        ref={listRef}
        role="listbox"
        aria-label={title}
        aria-multiselectable="true"
        className="space-y-0.5"
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag) return
          if (!drag.active && Math.abs(event.clientY - drag.startY) < 4) return
          drag.active = true
          setDropAt(rowIndexAt(event.clientY))
        }}
        onPointerUp={() => {
          const drag = dragRef.current
          dragRef.current = null
          const at = dropAt
          setDropAt(null)
          if (!drag?.active || at === null) return
          const without = topFirst.filter((layer) => layer.id !== drag.layerId).map((layer) => layer.id)
          const from = topFirst.findIndex((layer) => layer.id === drag.layerId)
          const insertAt = at > from ? at - 1 : at
          without.splice(insertAt, 0, drag.layerId)
          api.getState().dispatch({ type: 'layers.reorder', owner, order: [...without].reverse() })
        }}
      >
        {topFirst.map((layer, index) => (
          <React.Fragment key={layer.id}>
            {dropAt === index ? <div aria-hidden="true" className="mx-1 h-0.5 rounded bg-[var(--canvas-selection,#3B82F6)]" /> : null}
            <LayerRow
              owner={owner}
              layer={layer}
              selected={selected.has(layer.id)}
              hiddenByLayout={outOfLayout.has(layer.id)}
              index={index}
              count={layers.length}
              onDragStart={(event, layerId) => {
                if (event.button !== 0) return
                dragRef.current = { pointerId: event.pointerId, layerId, startY: event.clientY, active: false }
              }}
            />
          </React.Fragment>
        ))}
        {dropAt === topFirst.length ? <div aria-hidden="true" className="mx-1 h-0.5 rounded bg-[var(--canvas-selection,#3B82F6)]" /> : null}
      </div>
    </div>
  )
}

/** Layers of the active slide (and its panorama, if any). */
export function LayersPanel(): React.JSX.Element {
  const api = useEditorApi()
  const document = useEditor((state) => state.document)
  const { slide } = useActiveScene()
  const membership = panoramaFor(document, slide.id)
  return (
    <div className="space-y-4 p-3">
      <LayerList owner={{ kind: 'slide', id: slide.id }} layers={slide.layers} title={`${slide.name} layers`} />
      {membership ? <LayerList owner={{ kind: 'panorama', id: membership.panorama.id }} layers={membership.panorama.layers} title="Shared across panorama" /> : null}
      <button type="button" onClick={() => api.getState().clearSelection()} className="flex h-8 w-full items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-foreground/[0.05]">
        <span aria-hidden="true" className="w-4 text-center">▦</span>
        Background and slide settings
      </button>
    </div>
  )
}
