import type { QueryClient } from '@tanstack/react-query'
import type { TRPCLink } from '@trpc/client'
import { observable } from '@trpc/server/observable'
import type { AppRouter } from './router'

/** Covers imperative editor mutations as well as mutations made through query hooks. */
export function invalidateListsLink(queryClient: QueryClient): TRPCLink<AppRouter> {
  return () =>
    ({ op, next }) =>
      observable((observer) => {
        const [resource, action] = op.path.split('.')
        const changesList =
          op.type === 'mutation' &&
          ((resource === 'project' &&
            [
              'create',
              'rename',
              'updateDocument',
              'duplicate',
              'delete',
              'restoreVersion',
            ].includes(action)) ||
            (resource === 'creativeSet' &&
              [
                'create',
                'rename',
                'updateDocument',
                'duplicate',
                'archive',
                'restoreVersion',
                'attachCampaign',
              ].includes(action)) ||
            (resource === 'asset' && ['completeUpload', 'delete'].includes(action)))
        return next(op).subscribe({
          next(value) {
            if (changesList) void queryClient.invalidateQueries({ queryKey: [[resource, 'list']] })
            observer.next(value)
          },
          error: (error) => observer.error(error),
          complete: () => observer.complete(),
        })
      })
}
