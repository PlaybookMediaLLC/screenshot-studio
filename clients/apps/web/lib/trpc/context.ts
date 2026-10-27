import type { RequestReads } from '@/lib/auth/request-reads'

export type TRPCContext = {
  headers: Headers
  reads?: RequestReads
}

export function createTRPCContext(headers: Headers): TRPCContext {
  return { headers, reads: new Map() }
}
