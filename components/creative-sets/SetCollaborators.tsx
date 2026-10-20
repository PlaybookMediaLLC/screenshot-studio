'use client'

import { useCallback, useMemo } from 'react'
import { usePresence } from '@/lib/creative-sets/presence'
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
  const token = useCallback(
    async () =>
      (await session.client.creativeSet.collabToken.mutate({ creativeSetId: session.record.id }))
        .token,
    [session]
  )
  const fields = useMemo(() => ({ outputId, revision }), [outputId, revision])
  const { status, peers } = usePresence({
    url,
    room: `creative-set:${session.record.id}`,
    token,
    user,
    fields,
  })
  return (
    <span
      role="status"
      className={
        status === 'live' && !peers.length
          ? 'sr-only'
          : 'hidden max-w-56 truncate text-xs text-muted-foreground md:inline'
      }
      title={peers
        .map((peer) => `${peer.name}${peer.fields.outputId === outputId ? ' · this format' : ''}`)
        .join('\n')}
    >
      {status === 'live'
        ? peers.length
          ? `${peers.map((peer) => peer.name).join(', ')} here`
          : 'Live · only you here'
        : status === 'connecting'
          ? 'Presence reconnecting'
          : 'Shared editing · presence unavailable'}
    </span>
  )
}
