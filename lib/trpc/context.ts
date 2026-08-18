export type TRPCContext = {
  headers: Headers
}

export function createTRPCContext(headers: Headers): TRPCContext {
  return { headers }
}
