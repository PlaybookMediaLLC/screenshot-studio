import { TRPCClientError } from '@trpc/client'

function refused(error: Error): boolean {
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' && status >= 400 && status < 500
}

/** Product lists stay reusable during navigation and refresh after thirty seconds. */
export const productQueryOptions = {
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  refetchOnWindowFocus: true,
  // The tRPC transport owns its read retries and total timeout. A refusal
  // (4xx: no access, not on this plan, not found) gives the same answer twice.
  retry: (failures: number, error: Error) =>
    !(error instanceof TRPCClientError) && !refused(error) && failures < 2,
}
