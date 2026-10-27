'use client'

import { useCallback, useMemo, useEffect, useState } from 'react'
import { z } from 'zod'
import { artboardRect, type Artboard } from '@/lib/canvas/document'
import type { CanvasSession } from '@/lib/canvas/session'
import { useCanvasUi, useCanvasViewport } from '@/lib/canvas/ui-store'
import { rectToScreen } from '@/lib/canvas/viewport'
import { usePresence, type PresenceStatus } from '@/lib/creative-sets/presence'

/** What a canvas member shares with the others in the room. */
const canvasPresenceSchema = z.object({
  activeId: z.string().max(80).nullable().catch(null),
  selection: z.array(z.string().max(80)).max(20).catch([]),
  revision: z.number().int().nonnegative().catch(0),
})

/** Another member on this canvas: the artboard they have open, what they selected, their saved revision. */
export type CanvasPeer = z.infer<typeof canvasPresenceSchema> & {
  id: string
  name: string
  color: string
}

const COLORS = [
  '#e11d48',
  '#d97706',
  '#059669',
  '#0891b2',
  '#4f46e5',
  '#c026d3',
  '#65a30d',
  '#ea580c',
]

/** A stable colour per member, so everyone sees the same person in the same colour. */
function colorOf(id: string) {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return COLORS[Math.abs(hash) % COLORS.length]!
}

/**
 * Live presence on a canvas through the same room service as Story Sets.
 * Members share the artboard they have open, their artboard selection and
 * their saved revision; never pointer positions or content.
 */
export function useCanvasPresence(
  session: CanvasSession,
  url: string | null,
  user: { id: string; name: string },
  revision: number
): { status: PresenceStatus; peers: CanvasPeer[] } {
  const activeId = useCanvasUi((ui) => ui.activeId)
  const selection = useCanvasUi((ui) => ui.selection)
  const token = useCallback(
    async () =>
      (await session.client.canvas.collabToken.mutate({ canvasId: session.record.id })).token,
    [session]
  )
  const fields = useMemo(
    () => ({ activeId, selection: selection.slice(0, 20), revision }),
    [activeId, selection, revision]
  )
  const { status, peers } = usePresence({
    url,
    room: `creative-set:${session.record.id}`,
    token,
    user,
    fields,
  })
  return {
    status,
    peers: peers.map((peer) => ({
      id: peer.id,
      name: peer.name,
      color: colorOf(peer.id),
      ...canvasPresenceSchema.parse(peer.fields),
    })),
  }
}

/** Who else is here, beside the save status. */
export function PresenceSummary({
  status,
  peers,
}: {
  status: PresenceStatus
  peers: CanvasPeer[]
}) {
  const [showConnection, setShowConnection] = useState(false)
  useEffect(() => {
    setShowConnection(false)
    if (status === 'live' || status === 'unavailable') return
    const timer = setTimeout(() => setShowConnection(true), 3000)
    return () => clearTimeout(timer)
  }, [status])
  if (status === 'unavailable' || (status !== 'live' && !showConnection)) return null
  return (
    <span
      role="status"
      data-testid="canvas-presence"
      className={
        status === 'live' && !peers.length ? 'sr-only' : 'hidden items-center gap-1 md:flex'
      }
    >
      {status === 'live' ? (
        peers.length ? (
          <>
            <span className="flex -space-x-1.5" aria-hidden>
              {peers.slice(0, 4).map((peer) => (
                <span
                  key={peer.id}
                  title={peer.name}
                  className="flex size-6 items-center justify-center rounded-full border-2 border-background text-[10px] font-semibold text-white"
                  style={{ background: peer.color }}
                >
                  {peer.name.slice(0, 1).toUpperCase()}
                </span>
              ))}
            </span>
            <span className="max-w-48 truncate text-xs text-muted-foreground">
              {peers.map((peer) => peer.name).join(', ')} here
            </span>
          </>
        ) : (
          'Live · only you here'
        )
      ) : (
        <span className="text-xs text-muted-foreground">Presence reconnecting</span>
      )}
    </span>
  )
}

/** Rings on the artboards other members have open or selected, named so you can avoid each other's work. */
export function PeerMarkers({
  peers,
  artboards,
}: {
  peers: CanvasPeer[]
  artboards: readonly Artboard[]
}) {
  const viewport = useCanvasViewport((state) => state.viewport)
  const marks = peers.flatMap((peer) =>
    artboards.flatMap((artboard) => {
      const editing = peer.activeId === artboard.id
      if (!editing && !peer.selection.includes(artboard.id)) return []
      return [{ peer, artboard, editing }]
    })
  )
  return (
    <>
      {marks.map(({ peer, artboard, editing }, index) => {
        const rect = rectToScreen(viewport, artboardRect(artboard))
        // Several people on one artboard stack their labels instead of hiding each other.
        const stack = marks
          .slice(0, index)
          .filter((mark) => mark.artboard.id === artboard.id).length
        return (
          <div
            key={`${peer.id}:${artboard.id}`}
            data-testid="peer-marker"
            aria-label={`${peer.name} ${editing ? 'is editing' : 'selected'} ${artboard.name}`}
            className="pointer-events-none absolute z-20"
            style={{
              left: rect.x - 3 - stack * 3,
              top: rect.y - 3 - stack * 3,
              width: rect.width + 6 + stack * 6,
              height: rect.height + 6 + stack * 6,
              outline: `${editing ? 2 : 1}px ${editing ? 'solid' : 'dashed'} ${peer.color}`,
              borderRadius: 2,
            }}
          >
            <span
              className="absolute -bottom-5 right-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
              style={{ background: peer.color, transform: `translateY(${stack * 18}px)` }}
            >
              {peer.name}
              {editing ? ' · editing' : ''}
            </span>
          </div>
        )
      })}
    </>
  )
}
