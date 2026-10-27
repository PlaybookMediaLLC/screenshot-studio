import { TRPCClientError } from '@trpc/client'

/** Product lists stay reusable during navigation and refresh after thirty seconds. */
export const productQueryOptions = {
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  refetchOnWindowFocus: true,
  // The tRPC transport owns its read retries and total timeout.
  retry: (failures: number, error: Error) => !(error instanceof TRPCClientError) && failures < 2,
}
