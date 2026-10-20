'use client'

import { useEffect, useRef, useState } from 'react'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { z } from 'zod'

/** Whether presence is connected, reconnecting, or not configured. */
export const presenceStatusSchema = z.enum(['live', 'connecting', 'unavailable'])
/** One of {@link presenceStatusSchema}. */
export type PresenceStatus = z.infer<typeof presenceStatusSchema>

/** Another signed-in member in the same room, and the fields they share. */
export type Peer = { id: string; name: string; fields: Record<string, unknown> }

/** Presence tokens last five minutes; the connection is renewed before they expire. */
const RENEW_MS = 4 * 60 * 1000

/**
 * Who else has a creative set or canvas open, and what each one shares
 * (the format or artboard in front of them, their saved revision).
 * Awareness carries presence only: content is saved through revision-checked
 * writes and safe field merges. The collab server authorizes every message,
 * so share what changes on a click, never a pointer stream.
 */
export function usePresence({
  url,
  room,
  token,
  user,
  fields,
}: {
  url: string | null
  room: string
  token: () => Promise<string>
  user: { id: string; name: string }
  fields: Record<string, unknown>
}): { status: PresenceStatus; peers: Peer[] } {
  const provider = useRef<HocuspocusProvider | null>(null)
  const credential = useRef(token)
  const [online, setOnline] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [peers, setPeers] = useState<Peer[]>([])
  useEffect(() => {
    credential.current = token
  }, [token])
  useEffect(() => {
    if (!url) return
    const document = new Y.Doc()
    const offline = () => {
      setOnline(false)
      setPeers([])
    }
    const connection = new HocuspocusProvider({
      url,
      document,
      name: room,
      token: () => credential.current(),
      onAuthenticated: () => setOnline(true),
      onDisconnect: offline,
      onClose: offline,
      onAuthenticationFailed: offline,
    })
    const refresh = setInterval(() => setGeneration((value) => value + 1), RENEW_MS)
    provider.current = connection
    connection.setAwarenessField('user', { id: user.id, name: user.name })
    const update = () => {
      const members = new Map<string, Peer>()
      for (const [clientId, state] of connection.awareness?.getStates() ?? []) {
        if (
          clientId === document.clientID ||
          typeof state.user?.id !== 'string' ||
          typeof state.user?.name !== 'string'
        )
          continue
        const { user: member, ...shared } = state
        members.set(member.id, { id: member.id, name: member.name.slice(0, 100), fields: shared })
      }
      setPeers([...members.values()])
    }
    connection.awareness?.on('change', update)
    return () => {
      clearInterval(refresh)
      connection.awareness?.off('change', update)
      connection.destroy()
      document.destroy()
      provider.current = null
    }
  }, [url, room, user.id, user.name, generation])
  const published = JSON.stringify(fields)
  useEffect(() => {
    for (const [key, value] of Object.entries(JSON.parse(published) as Record<string, unknown>))
      provider.current?.setAwarenessField(key, value)
  }, [published, url, generation])
  return { status: !url ? 'unavailable' : online ? 'live' : 'connecting', peers }
}
