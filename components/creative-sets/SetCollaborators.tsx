'use client'

import { useEffect, useRef, useState } from 'react'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import type { CreativeSetSession } from '@/lib/creative-sets/session'

/** Awareness carries presence only. Set content uses revision-checked saves and safe field merges. */
export function SetCollaborators({
  session,
  url,
  user,
  outputId,
  revision,
}: {
  session: CreativeSetSession
  url: string | null
  user: { id: string; name: string }
  outputId: string
  revision: number
}) {
  const provider = useRef<HocuspocusProvider | null>(null)
  const [online, setOnline] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [peers, setPeers] = useState<{ id: string; name: string; outputId: string }[]>([])
  useEffect(() => {
    if (!url) return
    const document = new Y.Doc()
    const connection = new HocuspocusProvider({
      url,
      document,
      name: `creative-set:${session.record.id}`,
      token: async () =>
        (await session.client.creativeSet.collabToken.mutate({ creativeSetId: session.record.id }))
          .token,
      onAuthenticated: () => setOnline(true),
      onDisconnect: () => {
        setOnline(false)
        setPeers([])
      },
      onClose: () => {
        setOnline(false)
        setPeers([])
      },
      onAuthenticationFailed: () => {
        setOnline(false)
        setPeers([])
      },
    })
    const refresh = setInterval(() => setGeneration((value) => value + 1), 4 * 60 * 1000)
    provider.current = connection
    connection.setAwarenessField('user', user)
    const update = () => {
      const members = new Map<string, { id: string; name: string; outputId: string }>()
      for (const [clientId, state] of connection.awareness?.getStates() ?? []) {
        if (
          clientId === document.clientID ||
          typeof state.user?.id !== 'string' ||
          typeof state.user?.name !== 'string'
        )
          continue
        members.set(state.user.id, {
          id: state.user.id,
          name: state.user.name.slice(0, 100),
          outputId: typeof state.outputId === 'string' ? state.outputId : '',
        })
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
  }, [session, url, user, generation])
  useEffect(() => {
    provider.current?.setAwarenessField('outputId', outputId)
    provider.current?.setAwarenessField('revision', revision)
  }, [outputId, revision, url, generation])
  return (
    <span
      role="status"
      className={
        online && !peers.length
          ? 'sr-only'
          : 'hidden max-w-56 truncate text-xs text-muted-foreground md:inline'
      }
      title={peers
        .map((peer) => `${peer.name}${peer.outputId === outputId ? ' · this format' : ''}`)
        .join('\n')}
    >
      {online
        ? peers.length
          ? `${peers.map((peer) => peer.name).join(', ')} here`
          : 'Live · only you here'
        : url
          ? 'Presence reconnecting'
          : 'Shared editing · presence unavailable'}
    </span>
  )
}
