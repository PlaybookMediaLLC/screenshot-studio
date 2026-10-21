'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { z } from 'zod'
import { useHydratedSession } from '@/lib/auth/client'
import type { WorkspaceRequestScope } from '@/lib/auth/request-scope'
import { SettingsRequestError, settingsRequest } from '@/lib/settings/client'

/** Private set caches belong to one person in one workspace. */
export function socialSetKey(scope: WorkspaceRequestScope, id?: string) {
  const prefix = ['social-sets', scope.userId, scope.workspaceId] as const
  return id === undefined ? prefix : ([...prefix, id] as const)
}

/** Cancel old requests and refuse late saves/navigation after a context change. */
export function useSocialSetScope() {
  const { data, isPending } = useHydratedSession()
  const userId = data?.user.id ?? ''
  const workspaceId = data?.session.activeOrganizationId ?? ''
  const ready = !isPending && !!userId && !!workspaceId
  const queryClient = useQueryClient()
  const scope = useMemo(() => ({ userId, workspaceId }), [userId, workspaceId])
  const lifetime = useRef<{ scope: WorkspaceRequestScope; controller: AbortController } | null>(
    null
  )
  useLayoutEffect(() => {
    if (!ready) return
    const current = { scope, controller: new AbortController() }
    lifetime.current = current
    return () => {
      current.controller.abort()
      if (lifetime.current === current) lifetime.current = null
    }
  }, [scope, ready])
  useEffect(() => {
    const obsolete = (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[0] === 'social-sets' &&
      (query.queryKey[1] !== userId || query.queryKey[2] !== workspaceId)
    void queryClient.cancelQueries({ predicate: obsolete })
    queryClient.removeQueries({ predicate: obsolete })
  }, [queryClient, userId, workspaceId])
  const assertCurrent = useCallback(() => {
    const current = lifetime.current
    if (!ready || !current || current.scope !== scope) {
      throw new SettingsRequestError(
        'Your account or workspace changed. Reload this page to continue.',
        409,
        'workspace_changed'
      )
    }
    return current
  }, [scope, ready])
  const request = useCallback(
    async <Schema extends z.ZodType>(
      path: string,
      schema: Schema,
      options: Parameters<typeof settingsRequest<Schema>>[2] = {}
    ): Promise<z.output<Schema>> => {
      const current = assertCurrent()
      const signal = options.signal
        ? AbortSignal.any([options.signal, current.controller.signal])
        : current.controller.signal
      const result = await settingsRequest(path, schema, {
        ...options,
        scope: current.scope,
        signal,
      })
      assertCurrent()
      return result
    },
    [assertCurrent]
  )
  return useMemo(
    () => ({ ...scope, ready, key: socialSetKey(scope), request, assertCurrent }),
    [scope, ready, request, assertCurrent]
  )
}
