'use client'

import * as React from 'react'
import { contentDraftSchema } from '@/lib/api/contracts/content-drafts'
import type { DraftWire } from '@/lib/content-drafts/client'
import { readWire } from '@/lib/plan/wire'

/** Account-scoped source pages with cancellation, stable IDs, and an explicit retry. */
export function useDraftSources(
  setId: string | null,
  source: 'drafts' | 'posted',
  search: string,
  refresh = 0
) {
  const key = JSON.stringify([setId, source, search, refresh])
  const [cursor, setCursor] = React.useState({ key: '', value: '' })
  const [state, setState] = React.useState<{
    key: string
    items: DraftWire[]
    next: string | null
  }>({ key: '', items: [], next: null })
  const [failure, setFailure] = React.useState({ key: '', message: '' })
  const [loading, setLoading] = React.useState(false)
  const [retry, setRetry] = React.useState(0)
  const after = cursor.key === key ? cursor.value : ''
  React.useEffect(() => {
    if (!setId) return
    const controller = new AbortController()
    setLoading(true)
    setFailure({ key, message: '' })
    const params = new URLSearchParams({
      socialSetId: setId,
      view: source,
      search,
      limit: '50',
      ...(after ? { cursor: after } : {}),
    })
    fetch(`/api/v1/content-drafts?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.message ?? 'Content could not load.')
        const rows = [...result.pinned, ...result.items].map((row: unknown) =>
          readWire(contentDraftSchema, row)
        )
        if (!controller.signal.aborted)
          setState((previous) => ({
            key,
            items: [
              ...new Map(
                [...(after && previous.key === key ? previous.items : []), ...rows].map((row) => [
                  row.id,
                  row,
                ])
              ).values(),
            ],
            next: result.nextCursor,
          }))
      })
      .catch((error) => {
        if (!controller.signal.aborted) setFailure({ key, message: error.message })
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [key, setId, source, search, after, retry])
  return {
    items: state.key === key ? state.items : null,
    error: failure.key === key ? failure.message : '',
    loading,
    hasMore: state.key === key && Boolean(state.next),
    loadMore: () => setCursor({ key, value: state.next ?? '' }),
    retry: () => setRetry((value) => value + 1),
  }
}
