'use client'

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { useHydratedSession } from '@/lib/auth/client'

/** Cache identity follows both the authenticated person and active workspace. */
export function useNotificationIdentity() {
  const { data, isPending } = useHydratedSession()
  const userId = data?.user.id ?? ''
  const workspaceId = data?.session.activeOrganizationId ?? ''
  const queryClient = useQueryClient()
  const key = useMemo(
    () => ['workspace-notifications', userId, workspaceId] as const,
    [userId, workspaceId]
  )
  useEffect(() => {
    const predicate = (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[0] === 'workspace-notifications' &&
      (query.queryKey[1] !== userId || query.queryKey[2] !== workspaceId)
    void queryClient.cancelQueries({ predicate })
    queryClient.removeQueries({ predicate })
  }, [queryClient, userId, workspaceId])

  return useMemo(
    () => ({ userId, workspaceId, ready: !isPending && !!userId && !!workspaceId, key }),
    [userId, workspaceId, isPending, key]
  )
}

function subscribeVisibility(notify: () => void) {
  document.addEventListener('visibilitychange', notify)
  return () => document.removeEventListener('visibilitychange', notify)
}

/** Poll only while the page is visible. */
export function useNotificationPageVisible() {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === 'visible',
    () => false
  )
}

/** Fetch a scoped contract without retaining responses in the browser HTTP cache. */
export async function notificationRequest<S extends z.ZodType>(
  identity: { workspaceId: string; userId: string },
  path: string,
  schema: S,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<z.output<S>> {
  const response = await fetch(`/api/workspace/notifications${path}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    method: options.method,
    signal: options.signal,
    headers: {
      'content-type': 'application/json',
      'x-notification-workspace': identity.workspaceId,
      'x-notification-user': identity.userId,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    const failure = z
      .object({ error: z.string().optional(), message: z.string().optional() })
      .safeParse(body)
    throw new Error(
      failure.success
        ? (failure.data.error ?? failure.data.message ?? 'The request failed. Try again.')
        : 'The request failed. Try again.'
    )
  }
  return schema.parse(body)
}
