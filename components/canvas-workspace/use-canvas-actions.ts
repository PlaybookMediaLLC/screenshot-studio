'use client'

import { useMemo } from 'react'
import { toast } from 'sonner'
import type { CanvasSession } from '@/lib/canvas/session'
import type { CanvasCommand } from '@/lib/canvas/commands'
import {
  artboardRect,
  artboardSchema,
  boundsOf,
  type Artboard,
  type WorkspaceRect,
} from '@/lib/canvas/document'
import {
  alignRects,
  ARTBOARD_GAP,
  distributeRects,
  nextArtboardPosition,
  tidyRects,
  type AlignMode,
  type DistributeAxis,
} from '@/lib/canvas/layout'
import { blankArtboard, ARTBOARD_PRESETS, type ArtboardPreset } from '@/lib/canvas/recipes'
import { fitRect, steppedZoom, zoomAt, DEFAULT_VIEWPORT } from '@/lib/canvas/viewport'
import { adaptDocumentToSize } from '@/lib/export/adapt'
import { useCanvasUi, useCanvasViewport } from '@/lib/canvas/ui-store'

/** Artboards copied with ⌘C, kept for this tab so they paste into any canvas. */
let clipboard: Artboard[] = []

/** Every board operation, shared by shortcuts, menus and panels. Each command is one undo step. */
export function useCanvasActions(session: CanvasSession, flush: () => void) {
  return useMemo(() => {
    const document = () => session.snapshot().document
    const rects = (ids?: readonly string[]) =>
      document()
        .artboards.filter((artboard) => !ids || ids.includes(artboard.id))
        .map((artboard) => ({ id: artboard.id, rect: artboardRect(artboard) }))
    const ui = () => useCanvasUi.getState()
    const camera = () => useCanvasViewport.getState()

    function run(command: CanvasCommand): boolean {
      try {
        flush()
        session.command(command)
        return true
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'That change could not be applied.')
        return false
      }
    }

    function focus(rect: WorkspaceRect | null, maxZoom = 1) {
      if (!rect) return
      const { screen, setViewport } = camera()
      setViewport(fitRect(rect, screen, { padding: 72, maxZoom }))
    }

    /** Place a group of new artboards (laid out relative to each other) to the right of the board. */
    function addArtboards(artboards: Artboard[], { select = true, zoom = true } = {}) {
      if (!artboards.length) return []
      const group = boundsOf(artboards.map(artboardRect))!
      const target = nextArtboardPosition(rects().map((item) => item.rect))
      const placed = artboards.map((artboard) =>
        artboardSchema.parse({
          ...artboard,
          x: Math.round(artboard.x - group.x + target.x),
          y: Math.round(artboard.y - group.y + target.y),
        })
      )
      if (!run({ type: 'add-artboards', artboards: placed })) return []
      const ids = placed.map((artboard) => artboard.id)
      if (select) ui().select(ids)
      if (zoom) focus(boundsOf(placed.map(artboardRect)))
      return ids
    }

    function copies(ids: readonly string[], shift: { x: number; y: number }, suffix: string) {
      return document()
        .artboards.filter((artboard) => ids.includes(artboard.id))
        .map((artboard) => ({
          sourceId: artboard.id,
          id: crypto.randomUUID(),
          name: `${artboard.name.slice(0, 120 - suffix.length)}${suffix}`,
          x: Math.round(artboard.x + shift.x),
          y: Math.round(artboard.y + shift.y),
        }))
    }

    const actions = {
      run,
      /** Commit the open artboard's pending native edit now. */
      flush,
      focus,
      addArtboards,
      addPreset(preset: ArtboardPreset | { width: number; height: number }) {
        const position = nextArtboardPosition(rects().map((item) => item.rect))
        const artboard = blankArtboard(preset, position)
        run({ type: 'add-artboards', artboards: [artboard] })
        ui().select([artboard.id])
        focus(artboardRect(artboard))
        return artboard.id
      },
      duplicate(ids = ui().selection) {
        const bounds = boundsOf(rects(ids).map((item) => item.rect))
        if (!bounds) return
        const made = copies(ids, { x: 0, y: bounds.height + ARTBOARD_GAP }, ' copy')
        if (run({ type: 'duplicate-artboards', copies: made }))
          ui().select(made.map((copy) => copy.id))
      },
      /** New artboards adapted to other sizes, laid out again rather than stretched. */
      adaptTo(ids: readonly string[], presets: readonly ArtboardPreset[]) {
        const sources = document().artboards.filter((artboard) => ids.includes(artboard.id))
        const bounds = boundsOf(sources.map(artboardRect))
        if (!bounds || !presets.length) return
        let x = bounds.x
        const made: Artboard[] = []
        for (const source of sources)
          for (const preset of presets) {
            const size = ARTBOARD_PRESETS[preset]
            made.push(
              artboardSchema.parse({
                ...structuredClone(source),
                id: crypto.randomUUID(),
                name: `${source.name.slice(0, 90)} · ${size.name.split(' · ')[0]}`,
                x,
                y: bounds.y + bounds.height + ARTBOARD_GAP,
                document: adaptDocumentToSize(source.document, size),
              })
            )
            x += size.width + ARTBOARD_GAP
          }
        if (run({ type: 'add-artboards', artboards: made })) {
          ui().select(made.map((artboard) => artboard.id))
          focus(boundsOf(made.map(artboardRect)))
        }
      },
      remove(ids = ui().selection) {
        if (!ids.length) return
        const removed = ids.length
        if (run({ type: 'remove-artboards', ids: [...ids] })) {
          if (ids.includes(ui().activeId ?? '')) ui().activate(null)
          ui().select([])
          toast(`${removed === 1 ? 'Artboard' : `${removed} artboards`} deleted`, {
            action: { label: 'Undo', onClick: () => actions.undo() },
          })
        }
      },
      move(positions: { id: string; x: number; y: number }[]) {
        if (positions.length)
          run({
            type: 'move-artboards',
            positions: positions.map((position) => ({
              ...position,
              x: Math.round(position.x),
              y: Math.round(position.y),
            })),
          })
      },
      nudge(dx: number, dy: number) {
        actions.move(
          rects(ui().selection).map(({ id, rect }) => ({ id, x: rect.x + dx, y: rect.y + dy }))
        )
      },
      align(mode: AlignMode) {
        actions.move(alignRects(rects(ui().selection), mode))
      },
      distribute(axis: DistributeAxis) {
        actions.move(distributeRects(rects(ui().selection), axis))
      },
      tidy() {
        const ids = ui().selection.length > 1 ? ui().selection : undefined
        actions.move(tidyRects(rects(ids)))
      },
      rename(id: string, name: string) {
        if (name.trim()) run({ type: 'rename-artboard', id, name: name.trim() })
      },
      resize(id: string, width: number, height: number) {
        run({ type: 'resize-artboard', id, width: Math.round(width), height: Math.round(height) })
      },
      stack(move: 'front' | 'back', ids = ui().selection) {
        if (ids.length) run({ type: 'stack-artboards', ids: [...ids], move })
      },
      edit(id: string) {
        ui().activate(id)
        const artboard = document().artboards.find((item) => item.id === id)
        if (artboard) focus(artboardRect(artboard), 1.5)
      },
      exitEdit() {
        flush()
        ui().activate(null)
      },
      selectAll() {
        ui().select(document().artboards.map((artboard) => artboard.id))
      },
      copy(ids = ui().selection) {
        clipboard = structuredClone(
          document().artboards.filter((artboard) => ids.includes(artboard.id))
        )
        if (clipboard.length)
          toast(`Copied ${clipboard.length === 1 ? 'artboard' : `${clipboard.length} artboards`}`)
      },
      paste() {
        if (!clipboard.length) return
        addArtboards(
          clipboard.map((artboard) => ({ ...structuredClone(artboard), id: crypto.randomUUID() })),
          { zoom: false }
        )
      },
      undo() {
        flush()
        session.undo()
      },
      redo() {
        flush()
        session.redo()
      },
      fitAll() {
        focus(boundsOf(rects().map((item) => item.rect)))
      },
      fitSelection() {
        const ids = ui().selection.length ? ui().selection : ui().activeId ? [ui().activeId!] : []
        focus(boundsOf(rects(ids).map((item) => item.rect)), 2)
      },
      zoomTo(zoom: number) {
        const { screen, viewport, setViewport } = camera()
        setViewport(zoomAt(viewport, { x: screen.width / 2, y: screen.height / 2 }, zoom))
      },
      zoomStep(direction: 1 | -1) {
        actions.zoomTo(steppedZoom(camera().viewport.zoom, direction))
      },
      resetView() {
        camera().setViewport(DEFAULT_VIEWPORT)
      },
    }
    return actions
  }, [session, flush])
}

/** The board operations available to every panel. */
export type CanvasActions = ReturnType<typeof useCanvasActions>
